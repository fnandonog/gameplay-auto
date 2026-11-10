import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { erroGrave, lerPausa, motivosRecusa } from '../src/qualidade.js';
import { camposPost, postarAprovados } from '../src/postagem.js';

const bom = { titulo: 'Virada', gancho: 'NÃO ACREDITO', inicio: 0, fim: 30, nota: 9 };

test('filtro: nota, duração, título e gancho', () => {
  assert.deepEqual(motivosRecusa(bom), []);
  assert.equal(motivosRecusa({ ...bom, nota: 8 }).length, 1);
  assert.match(motivosRecusa({ ...bom, fim: 200 })[0], /duração/);
  assert.equal(motivosRecusa({ ...bom, titulo: '', gancho: '' }).length, 2);
  assert.deepEqual(motivosRecusa({ ...bom, nota: 8 }, { config: { notaMinima: 7.5 } }), []);
});

test('filtro: terceiro só passa com crédito, permissão registrada e CLIPAÍ automático', () => {
  const c = { ...bom, credito: { streamer: '@a' } };
  const fontes = [{ streamer: '@a', permissao: 'print da DM 10/11' }];
  assert.ok(motivosRecusa(c, { config: { terceiros: { fontes } } }).some((m) => /manual/.test(m)));
  assert.deepEqual(motivosRecusa(c, { config: { terceiros: { fontes, automatico: true } } }), []);
  assert.ok(motivosRecusa({ ...c, credito: { streamer: '@b' } }, { config: { terceiros: { fontes, automatico: true } } }).some((m) => /permissão/.test(m)));
  assert.ok(motivosRecusa(bom, { linha: { terceiros: true }, config: { terceiros: { automatico: true } } }).some((m) => /crédito/.test(m)));
});

test('erro grave = a plataforma recusou; erro de rede não', () => {
  assert.equal(erroGrave('Upload-Post 403: account suspended'), true);
  assert.equal(erroGrave('copyright claim'), true);
  assert.equal(erroGrave('fetch failed: ETIMEDOUT'), false);
});

test('Facebook vai como Reels com a legenda e a página da linha', () => {
  const f = camposPost({ ...bom, descricao: '', hashtags: [] }, { perfil: 'p', redes: ['facebook'], facebookPage: '123' });
  const get = (k) => f.filter(([n]) => n === k).map(([, v]) => v);
  assert.deepEqual(get('facebook_media_type'), ['REELS']);
  assert.deepEqual(get('facebook_page_id'), ['123']);
});

test('piloto automático posta sozinho e pausa tudo quando a plataforma recusa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  fs.mkdirSync(path.join(dir, 's1'));
  fs.writeFileSync(path.join(dir, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [
    { ...bom, arquivo: 'a.mp4', status: 'aguardando' }, { ...bom, arquivo: 'b.mp4', nota: 8.7, status: 'aguardando' }, { ...bom, arquivo: 'c.mp4', nota: 5, status: 'aguardando' },
  ] }));
  process.env.UPLOAD_POST_API_KEY = 'x';
  let chamadas = 0;
  const n = await postarAprovados({ pastaSaida: dir, postarAutomatico: true, uploadPost: { perfil: 'p', horarios: ['12:00', '21:00'] } }, {
    log: () => {}, agora: Date.parse('2026-11-09T23:40:00Z'),
    envio: async () => { chamadas++; if (chamadas === 2) throw new Error('Upload-Post 403: account suspended'); return 'j'; },
  });
  assert.equal(n, 1);
  assert.match(lerPausa(dir).motivo, /recusou/);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 's1', 'sessao.json'), 'utf8'));
  assert.deepEqual(s.cortes.map((c) => c.status), ['agendado', 'aprovado', 'descartado']);
  // paused: nothing more goes out until the owner resumes
  assert.equal(await postarAprovados({ pastaSaida: dir, uploadPost: { perfil: 'p' } }, { log: () => {}, envio: async () => { throw new Error('não devia'); } }), 0);
  delete process.env.UPLOAD_POST_API_KEY;
});
