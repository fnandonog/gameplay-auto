import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarPainel, editarCorte, listarSessoes, nomeSeguro } from '../src/painel.js';

function pastaFake() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-'));
  fs.mkdirSync(path.join(dir, 's1'));
  fs.writeFileSync(path.join(dir, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', criadoEm: '2026-11-09', cortes: [{ arquivo: '01-a.mp4', titulo: 't', status: 'aguardando' }] }));
  fs.writeFileSync(path.join(dir, 's1', '01-a.mp4'), Buffer.alloc(1000, 7));
  return dir;
}

test('nomes com barra ou .. não passam', () => {
  assert.equal(nomeSeguro('01-a.mp4'), true);
  for (const n of ['../x', 'a/b', '..', '.env', '', null]) assert.equal(nomeSeguro(n), false);
});

test('aprova e edita título e hashtags no sessao.json', () => {
  const dir = pastaFake();
  const c = editarCorte(dir, { pasta: 's1', arquivo: '01-a.mp4', status: 'aprovado', titulo: 'Novo', hashtags: ['#fifa', 'ps5'] });
  assert.equal(c.status, 'aprovado');
  assert.deepEqual(listarSessoes(dir)[0].cortes[0].hashtags, ['fifa', 'ps5']);
  assert.throws(() => editarCorte(dir, { pasta: 's1', arquivo: '01-a.mp4', status: 'hackeado' }));
  assert.throws(() => editarCorte(dir, { pasta: '..', arquivo: 'sessao.json' }));
});

test('servidor: lista, entrega vídeo em pedaços e exige a senha', async () => {
  const dir = pastaFake();
  const srv = criarPainel({ pastaSaida: dir, senhaPainel: 'abc' }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/sessoes`)).status, 401);
    const h = { cookie: 'painel=abc' };
    assert.equal((await (await fetch(`${base}/api/sessoes`, { headers: h })).json())[0].sessao, 's1');
    const r = await fetch(`${base}/midia/s1/01-a.mp4`, { headers: { ...h, range: 'bytes=10-19' } });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 10);
    assert.equal((await fetch(`${base}/midia/s1/sessao.json`, { headers: h })).status, 404);
    assert.equal((await fetch(`${base}/midia/..%2F..%2Fetc/passwd`, { headers: h })).status, 404);
  } finally { srv.close(); }
});
