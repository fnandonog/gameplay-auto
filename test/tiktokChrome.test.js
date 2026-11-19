import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  garantirToken, bearerOk, assinar, assinaturaOk, partesDoId, legendaTikTok, proximoJob, arquivoDoVideo, registrarResultado, ESPERA_MS,
} from '../src/tiktokChrome.js';
import { criarPainel } from '../src/painel.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tt-'));
function entregar(base, linha, pasta, post, { video = true, postado } = {}) {
  const dir = path.join(base, linha, pasta);
  fs.mkdirSync(dir, { recursive: true });
  if (video) fs.writeFileSync(path.join(dir, 'video.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ linha: { id: linha, redes: ['tiktok', 'instagram'] }, ...post }));
  if (postado) fs.writeFileSync(path.join(dir, 'postado.json'), JSON.stringify(postado));
  return dir;
}
const T = 'a'.repeat(48);

test('garantirToken creates an owner-only code once and keeps it', () => {
  const f = path.join(tmp(), 'sub', '.tok');
  const a = garantirToken(f);
  assert.equal(a.length, 48);
  assert.equal(garantirToken(f), a);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('bearer and per-video signature', () => {
  assert.ok(bearerOk(`Bearer ${T}`, T));
  assert.ok(!bearerOk('Bearer errado', T));
  assert.ok(!bearerOk('', T));
  const s = assinar(T, 'principal/x');
  assert.ok(assinaturaOk(T, 'principal/x', s));
  assert.ok(!assinaturaOk(T, 'principal/y', s));
  assert.ok(!assinaturaOk(T, 'principal/x', null));
});

test('partesDoId only takes two plain folder names', () => {
  assert.deepEqual(partesDoId('principal/2026_corte'), { linha: 'principal', pasta: '2026_corte' });
  for (const id of ['../x', 'a/../b', 'a/b/c', 'a/.oculto', 'a', '', null]) assert.equal(partesDoId(id), null, String(id));
});

test('legendaTikTok uses the delivered caption, or title + description + hashtags, max 2200', () => {
  assert.equal(legendaTikTok({ legendas: { tiktok: 'pronta' } }), 'pronta');
  assert.equal(legendaTikTok({ gancho: 'Olha isso', descricao: 'GTA 6', hashtags: ['gta6', '#dicas'] }), 'Olha isso\n\nGTA 6\n\n#gta6 #dicas');
  assert.equal(legendaTikTok({ titulo: 'T', gancho: 'G' }), 'T');
  assert.equal(legendaTikTok({ legendas: { tiktok: 'x'.repeat(3000) } }).length, 2200);
});

test('proximoJob: oldest due TikTok post, skips future, posted, other lines, missing video and pause; locks 15 min', () => {
  const base = tmp();
  const agora = Date.parse('2026-11-19T12:00:00Z');
  entregar(base, 'principal', 'b', { titulo: 'B', agendarPara: '2026-11-19T11:00:00Z' });
  entregar(base, 'principal', 'a', { titulo: 'A', agendarPara: '2026-11-19T10:00:00Z' });
  entregar(base, 'principal', 'futuro', { titulo: 'F', agendarPara: '2026-11-20T13:00:00Z' });
  entregar(base, 'principal', 'feito', { titulo: 'P', agendarPara: '2026-11-19T09:00:00Z' }, { postado: { links: { tiktok: 'https://t' } } });
  entregar(base, 'principal', 'semvideo', { titulo: 'S' }, { video: false });
  const dirYt = path.join(base, 'youtube-longo', 'l');
  fs.mkdirSync(dirYt, { recursive: true });
  fs.writeFileSync(path.join(dirYt, 'video.mp4'), 'x');
  fs.writeFileSync(path.join(dirYt, 'post.json'), JSON.stringify({ linha: { redes: ['youtube'] } }));

  assert.equal(proximoJob({ base, token: T, agora, pausa: { motivo: 'x' } }), null);
  const j = proximoJob({ base, token: T, agora });
  assert.equal(j.id, 'principal/a');
  assert.equal(j.legenda, 'A');
  assert.match(j.video, new RegExp(`^/api/tiktok-chrome/video/principal%2Fa\\?t=${assinar(T, 'principal/a')}$`));
  // a is locked now: next one is b; after 15 min a comes back (second try), then never again
  assert.equal(proximoJob({ base, token: T, agora }).id, 'principal/b');
  assert.equal(proximoJob({ base, token: T, agora }), null);
  assert.equal(proximoJob({ base, token: T, agora: agora + ESPERA_MS + 1 }).id, 'principal/a');
  assert.equal(proximoJob({ base, token: T, agora: agora + 3 * ESPERA_MS }).id, 'principal/b');
  assert.equal(proximoJob({ base, token: T, agora: agora + 5 * ESPERA_MS }), null);
});

test('a post already on Instagram still goes to TikTok', () => {
  const base = tmp();
  entregar(base, 'principal', 'ig', { titulo: 'I' }, { postado: { em: 'x', links: { instagram: 'https://ig' } } });
  assert.equal(proximoJob({ base, token: T }).id, 'principal/ig');
});

test('registrarResultado merges the TikTok link and keeps the other networks; errors block after Publish was clicked', () => {
  const base = tmp();
  const dir = entregar(base, 'principal', 'p', { titulo: 'P' }, { postado: { em: '2026-01-01', links: { instagram: 'https://ig' } } });
  const r = registrarResultado(base, { id: 'principal/p', ok: true, link: 'https://www.tiktok.com/@x/video/1' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'postado.json'), 'utf8')).links, { instagram: 'https://ig', tiktok: 'https://www.tiktok.com/@x/video/1' });
  assert.ok(r.ok);

  const d2 = entregar(base, 'principal', 'q', { titulo: 'Q' });
  registrarResultado(base, { id: 'principal/q', ok: false, erro: 'sumiu', etapa: 'clicar em Publicar', postou: true }, 0);
  assert.ok(!fs.existsSync(path.join(d2, 'postado.json')));
  assert.equal(proximoJob({ base, token: T, agora: 10 * ESPERA_MS }), null);
  assert.throws(() => registrarResultado(base, { id: '../etc', ok: true }), /não encontrado/);
});

test('arquivoDoVideo stays inside the delivery folder', () => {
  const base = tmp();
  entregar(base, 'principal', 'v', {});
  assert.equal(arquivoDoVideo(base, 'principal/v'), path.join(base, 'principal', 'v', 'video.mp4'));
  assert.equal(arquivoDoVideo(base, 'principal/../../etc'), null);
  assert.equal(arquivoDoVideo(base, 'principal/nada'), null);
});

test('panel routes: code required, signed video link, result, local-only code', async () => {
  const base = tmp(), saida = tmp();
  const arquivoTokenTiktok = path.join(tmp(), '.tok');
  entregar(base, 'principal', 'p', { titulo: 'P', legendas: { tiktok: 'leg' } });
  const srv = criarPainel({ pastaSaida: saida, pastaEntrega: base, arquivoTokenTiktok, senhaPainel: 'abc' }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  const u = `http://127.0.0.1:${srv.address().port}/api/tiktok-chrome`;
  try {
    assert.equal((await fetch(`${u}/proximo`)).status, 401);
    const tok = fs.readFileSync(arquivoTokenTiktok, 'utf8').trim();
    const auth = { authorization: `Bearer ${tok}` };
    const { job } = await (await fetch(`${u}/proximo`, { headers: auth })).json();
    assert.equal(job.legenda, 'leg');
    const v = await fetch(`http://127.0.0.1:${srv.address().port}${job.video}`);
    assert.equal(v.status, 200);
    assert.equal(v.headers.get('access-control-allow-origin'), 'https://www.tiktok.com');
    assert.equal(await v.text(), 'mp4');
    assert.equal((await fetch(`${u}/video/${encodeURIComponent(job.id)}?t=errado`)).status, 401);
    const pre = await fetch(`${u}/video/x`, { method: 'OPTIONS' });
    assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
    const r = await fetch(`${u}/resultado`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: job.id, ok: true }) });
    assert.equal((await r.json()).postado.links.tiktok, 'publicado');
    assert.equal((await fetch(`${u}/codigo`)).status, 403); // panel password not given
    const c = await fetch(`${u}/codigo`, { headers: { cookie: 'painel=abc' } });
    assert.equal((await c.json()).codigo, tok);
  } finally { srv.close(); }
});
