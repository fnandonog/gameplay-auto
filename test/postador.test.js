import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proximoEnvio, contagemHoje, redesConectadas, rodadaPostador, listarEntregues, gravarSucesso } from '../src/postador.js';
import { statusApis, lerCredenciais, salvarCredenciais, PUBLICOS } from '../src/credenciais.js';
import { erroGraph, legendaMeta, urlLogin as metaLogin, escolherPagina } from '../src/postadores/meta.js';
import { metadadosYoutube, playlistsDoPost, erroYoutube, urlLogin as ytLogin } from '../src/postadores/youtube.js';
import { motivosRecusa } from '../src/qualidade.js';
import { proximoJob } from '../src/tiktokChrome.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pst-'));
const AGORA = Date.parse('2026-11-19T18:00:00Z'); // 15:00 in São Paulo
function entregar(base, pasta, post, postado) {
  const dir = path.join(base, 'principal', pasta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'video.mp4'), 'mp4');
  fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify({ linha: { id: 'principal', redes: ['tiktok', 'instagram', 'facebook', 'youtube'] }, ...post }));
  if (postado) fs.writeFileSync(path.join(dir, 'postado.json'), JSON.stringify(postado));
  return dir;
}
const credOk = { meta: { appId: '1', appSecret: 's', pageToken: 't', pageId: 'p', igUserId: 'ig' }, youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } };

test('proximoEnvio: oldest due post, network order, skips posted, future, warnings and retries', () => {
  const base = tmp();
  entregar(base, 'a', { titulo: 'A', agendarPara: '2026-11-19T15:00:00Z' }, { links: { instagram: 'x' } });
  entregar(base, 'b', { titulo: 'B', agendarPara: '2026-11-19T16:00:00Z' });
  entregar(base, 'futuro', { titulo: 'F', agendarPara: '2026-11-20T15:00:00Z' });
  entregar(base, 'nudez', { titulo: 'N', agendarPara: '2026-11-19T10:00:00Z', aviso: 'nudez na tela' });
  const posts = listarEntregues(base);
  let p = proximoEnvio(posts, { agora: AGORA });
  assert.equal(p.post.id, 'principal/a');
  assert.equal(p.rede, 'facebook'); // instagram already posted
  assert.equal(proximoEnvio(posts, { agora: AGORA, conectadas: ['youtube'] }).rede, 'youtube');
  posts.find((x) => x.id === 'principal/a').estado = { facebook: { tentativas: 1, proximaEm: '2026-11-19T19:00:00Z' }, youtube: { tentativas: 3 } };
  p = proximoEnvio(posts, { agora: AGORA });
  assert.equal(p.post.id, 'principal/b');
  assert.equal(p.rede, 'instagram');
  assert.equal(proximoEnvio(posts, { agora: Date.parse('2026-11-19T08:00:00Z') }), null);
});

test('daily safe limit per network (São Paulo day)', () => {
  const base = tmp();
  for (let i = 0; i < 3; i++) entregar(base, `f${i}`, { titulo: `F${i}` }, { links: { instagram: 'x', facebook: 'y', youtube: 'z' }, emRede: { instagram: '2026-11-19T12:00:00Z', facebook: '2026-11-19T12:00:00Z', youtube: '2026-11-19T12:00:00Z' } });
  entregar(base, 'novo', { titulo: 'N', agendarPara: '2026-11-19T12:00:00Z' });
  const posts = listarEntregues(base);
  assert.deepEqual(contagemHoje(posts, AGORA), { instagram: 3, facebook: 3, youtube: 3 });
  assert.equal(proximoEnvio(posts, { agora: AGORA }).rede, 'youtube'); // IG 3/3, FB 3/3, YT 3/4
  assert.equal(proximoEnvio(posts, { agora: AGORA, limites: { youtube: 3 } }), null);
  assert.equal(proximoEnvio(posts, { agora: Date.parse('2026-11-20T18:00:00Z') }).rede, 'instagram'); // next day
});

test('rodadaPostador posts one network, merges links, and a grave error pulls the brake', async () => {
  const base = tmp(), saida = tmp();
  const arquivoCredenciais = path.join(tmp(), '.cred.json');
  fs.writeFileSync(arquivoCredenciais, JSON.stringify(credOk));
  const dir = entregar(base, 'p', { titulo: 'P' }, { links: { tiktok: 'https://tt' } });
  const config = { pastaEntrega: base, pastaSaida: saida, arquivoCredenciais, postadorLigado: true };
  assert.equal((await rodadaPostador({ ...config, postadorLigado: false })).feito, 'desligado');
  const chamadas = [];
  const publicar = { instagram: async () => { chamadas.push('ig'); return { link: 'https://ig/1' } }, facebook: async () => { throw Object.assign(new Error('API access blocked'), { grave: true }); }, youtube: async () => ({ link: 'https://yt' }) };
  const r = await rodadaPostador(config, { agora: AGORA, publicar, log: () => {} });
  assert.equal(r.feito, 'publicado');
  assert.deepEqual(chamadas, ['ig']);
  const postado = JSON.parse(fs.readFileSync(path.join(dir, 'postado.json'), 'utf8'));
  assert.deepEqual(postado.links, { tiktok: 'https://tt', instagram: 'https://ig/1' });
  assert.ok(postado.emRede.instagram);
  const r2 = await rodadaPostador(config, { agora: AGORA, publicar, log: () => {} });
  assert.equal(r2.feito, 'erro');
  assert.ok(r2.grave);
  assert.ok(fs.existsSync(path.join(saida, '.pausa.json')));
  assert.equal((await rodadaPostador(config, { agora: AGORA, publicar, log: () => {} })).feito, 'pausado');
});

test('an expired token stops only that network', async () => {
  const base = tmp(), saida = tmp();
  const arquivoCredenciais = path.join(tmp(), '.cred.json');
  fs.writeFileSync(arquivoCredenciais, JSON.stringify(credOk));
  entregar(base, 'p', { titulo: 'P', linha: { redes: ['youtube', 'instagram'] } });
  const publicar = { youtube: async () => { throw Object.assign(new Error('expirou'), { reconectar: true }); }, instagram: async () => ({ link: 'https://ig' }) };
  const config = { pastaEntrega: base, pastaSaida: saida, arquivoCredenciais, postadorLigado: true };
  await rodadaPostador(config, { agora: AGORA, publicar, log: () => {} });
  const c = lerCredenciais(arquivoCredenciais);
  assert.equal(c.youtube.erro, 'expirou');
  assert.deepEqual(redesConectadas(c), ['instagram', 'facebook']);
  assert.equal(statusApis(c).youtube.status, 'erro');
  assert.ok(!fs.existsSync(path.join(saida, '.pausa.json')));
  assert.equal(fs.statSync(arquivoCredenciais).mode & 0o777, 0o600);
});

test('statusApis never exposes secrets and starts from the public app ids', () => {
  const f = path.join(tmp(), 'c.json');
  let s = statusApis(lerCredenciais(f));
  assert.equal(s.instagram.status, 'falta credencial');
  assert.equal(s.meta.appId, PUBLICOS.meta.appId);
  salvarCredenciais(f, 'meta', { appSecret: 'SEGREDO' });
  s = statusApis(lerCredenciais(f));
  assert.equal(s.facebook.status, 'falta conectar');
  assert.ok(!JSON.stringify(s).includes('SEGREDO'));
  assert.equal(s.meta.temSegredo, true);
  assert.throws(() => salvarCredenciais(f, 'outra', {}), /inválida/);
});

test('Graph and YouTube errors are classified', () => {
  assert.ok(erroGraph({ error: { code: 190, message: 'x' } }, 400).reconectar);
  assert.ok(erroGraph({ error: { code: 1, message: 'API access blocked' } }, 400).grave);
  assert.equal(erroGraph({ error: { code: 4, message: 'rate' } }, 400).adiar, 3600000);
  assert.ok(erroYoutube({ error: 'invalid_grant' }, 400).reconectar);
  assert.ok(erroYoutube({ error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } }, 403).adiar);
  assert.ok(erroYoutube({ error: { message: 'Channel suspended' } }, 403).grave);
});

test('captions, YouTube metadata and playlists', () => {
  assert.equal(legendaMeta({ legendas: { instagram: 'pronta' } }, 'instagram'), 'pronta');
  assert.equal(legendaMeta({ titulo: 'T', hashtags: ['gta6'] }, 'facebook'), 'T\n\n#gta6');
  const m = metadadosYoutube({ titulo: 'Olha isso', hashtags: ['#gta6', 'dicas'], descricao: 'd' });
  assert.equal(m.snippet.title, 'Olha isso #shorts');
  assert.deepEqual(m.snippet.tags, ['gta6', 'dicas']);
  assert.equal(m.snippet.categoryId, '20');
  assert.equal(m.status.privacyStatus, 'public');
  assert.equal(metadadosYoutube({ tipo: 'missao', legendas: { youtube: { titulo: 'Missão 1', descricao: 'x' } } }).snippet.title, 'Missão 1');
  const ids = { shorts: 'S', curiosidades: 'C', dicas: 'D', missoes: 'M' };
  assert.deepEqual(playlistsDoPost({ titulo: 'Como pegar a arma secreta' }, ids), ['S', 'D']);
  assert.deepEqual(playlistsDoPost({ titulo: 'O Jason tem o poder do Franklin?' }, ids), ['S', 'C']);
  assert.deepEqual(playlistsDoPost({ tipo: 'missao' }, ids), ['M']);
  assert.deepEqual(playlistsDoPost({ tipo: 'longo' }, ids), []);
  assert.deepEqual(playlistsDoPost({ titulo: 'x' }, {}), []);
});

test('OAuth URLs and Page choice', () => {
  const m = new URL(metaLogin({ appId: '1', configId: '9', redirect: 'http://localhost:4322/oauth/meta', state: 's' }));
  assert.equal(m.searchParams.get('config_id'), '9');
  assert.equal(m.searchParams.get('redirect_uri'), 'http://localhost:4322/oauth/meta');
  const y = new URL(ytLogin({ clientId: 'c', redirect: 'http://localhost:4322/oauth/youtube', state: 's' }));
  assert.equal(y.searchParams.get('access_type'), 'offline');
  assert.match(y.searchParams.get('scope'), /youtube\.upload/);
  assert.equal(escolherPagina([{ id: '1', name: 'Loja' }, { id: '2', name: 'Fnando' }]).id, '2');
  assert.equal(escolherPagina([{ id: '1', name: 'Loja' }, { id: '2', name: 'Outra' }]), null);
  assert.equal(escolherPagina([{ id: '1', name: 'Loja' }, { id: '2', name: 'Outra' }], '1').id, '1');
});

test('nudity stretch and warnings never pass the automatic filter', () => {
  const config = { filtro: { notaMinima: 0 }, trechosBloqueados: [{ sessao: '2026-11-19 07-56-04', inicio: 513, fim: 680, motivo: 'nudez' }] };
  const c = { nota: 9, titulo: 'T', gancho: 'G', inicio: 600, fim: 640 };
  assert.match(motivosRecusa(c, { config, sessao: '2026-11-19 07-56-04' }).join(), /trecho bloqueado/);
  assert.equal(motivosRecusa(c, { config, sessao: 'outra' }).length, 0);
  assert.equal(motivosRecusa({ ...c, inicio: 480, fim: 510 }, { config, sessao: '2026-11-19 07-56-04' }).length, 0);
  assert.match(motivosRecusa({ ...c, aviso: 'gore' }, { config }).join(), /aviso/);
});

test('TikTok extension also skips warnings and respects its daily limit', () => {
  const base = tmp();
  entregar(base, 'n', { titulo: 'N', aviso: 'nudez' });
  assert.equal(proximoJob({ base, token: 'a'.repeat(48), agora: AGORA }), null);
  for (let i = 0; i < 4; i++) gravarSucesso(entregar(base, `t${i}`, { titulo: 'x' }, { links: { tiktok: 'https://t' } }), 'tiktok', 'https://t', AGORA);
  entregar(base, 'livre', { titulo: 'L' });
  assert.equal(proximoJob({ base, token: 'a'.repeat(48), agora: AGORA }), null);
  assert.equal(proximoJob({ base, token: 'a'.repeat(48), agora: AGORA + 86400000 }).id, 'principal/livre');
});

test('cuts made without the AI never pass the automatic filter', () => {
  const ok = { nota: 9.5, titulo: 'O celular do GTA 6 tem rede social', gancho: 'OLHA', inicio: 0, fim: 30 };
  assert.equal(motivosRecusa(ok).length, 0);
  assert.match(motivosRecusa({ ...ok, semIa: true }).join(), /sem a IA/);
  assert.match(motivosRecusa({ ...ok, titulo: 'Não acredito no que aconteceu 😱' }).join(), /sem a IA/);
});

test('proximoEnvio: YouTube only takes the best of the day when the quota is short', () => {
  const base = tmp();
  entregar(base, 'fraco', { titulo: 'F', nota: 5, agendarPara: '2026-11-19T15:00:00Z' });
  entregar(base, 'forte', { titulo: 'B', nota: 9, agendarPara: '2026-11-19T20:00:00Z' });
  entregar(base, 'medio', { titulo: 'M', nota: 7, agendarPara: '2026-11-19T16:00:00Z' });
  const posts = listarEntregues(base);
  const yt = (lim) => proximoEnvio(posts, { agora: AGORA, conectadas: ['youtube'], limites: { youtube: lim } });
  assert.equal(yt(1), null); // the best (forte) is not due yet; fraco and medio wait
  assert.equal(yt(2).post.id, 'principal/medio');
  assert.equal(yt(3).post.id, 'principal/fraco');
});

import { proximoJobYoutube, registrarResultadoYoutube } from '../src/youtubeChrome.js';
test('YouTube by Chrome takes what the API quota leaves, never the same post', () => {
  const base = tmp();
  entregar(base, 'fraco', { titulo: 'F', nota: 5, agendarPara: '2026-11-19T15:00:00Z' });
  entregar(base, 'forte', { titulo: 'B', nota: 9, agendarPara: '2026-11-19T16:00:00Z' });
  fs.writeFileSync(path.join(base, 'principal', 'forte', 'capa.jpg'), 'jpg');
  const j = proximoJobYoutube({ base, token: 'x'.repeat(40), agora: AGORA, apiLimite: 1 });
  assert.equal(j.id, 'principal/fraco');
  assert.match(j.titulo, /#shorts/);
  assert.equal(proximoJobYoutube({ base, token: 'x'.repeat(40), agora: AGORA, apiLimite: 1 }), null); // forte is the API's; fraco is handed out
  const posts = listarEntregues(base);
  assert.equal(proximoEnvio(posts, { agora: AGORA, conectadas: ['youtube'], limites: { youtube: 2 } }).post.id, 'principal/forte'); // fraco is with Chrome
  registrarResultadoYoutube(base, { id: 'principal/fraco', ok: true, link: 'https://youtube.com/shorts/abc' }, AGORA);
  const p2 = listarEntregues(base);
  assert.equal(p2.find((p) => p.id === 'principal/fraco').postado.links.youtube, 'https://youtube.com/shorts/abc');
  assert.equal(contagemHoje(p2, AGORA).youtube, undefined); // does not use up the API count
  const j2 = proximoJobYoutube({ base, token: 'x'.repeat(40), agora: AGORA, apiLimite: 0 });
  assert.equal(j2.id, 'principal/forte');
  assert.ok(j2.capa.startsWith('/api/tiktok-chrome/capa/'));
});
