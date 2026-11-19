import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listarBrutos, listarRoteiros, listarProntos, lerRedes, resumo, nomeDeEnvio, pastaDaGravacao } from '../src/central.js';
import { criarPainel } from '../src/painel.js';

function montar() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'central-'));
  const c = { pastaEntrada: path.join(d, 'inbox'), pastaSaida: path.join(d, 'cortes'), pastaProcessados: path.join(d, 'gravacoes'),
    pastaEntrega: path.join(d, 'prontos'), pastaRoteiros: path.join(d, 'roteiros'), arquivoMetricas: path.join(d, 'metricas.json'),
    linhas: [{ id: 'principal', nome: 'FNANDO', redes: ['tiktok', 'youtube'] }] };
  for (const p of [c.pastaEntrada, c.pastaProcessados, c.pastaRoteiros]) fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(c.pastaEntrada, 'nova.mp4'), 'x');
  fs.utimesSync(path.join(c.pastaEntrada, 'nova.mp4'), new Date('2026-11-19T10:00:00Z'), new Date('2026-11-19T10:00:00Z'));
  fs.writeFileSync(path.join(c.pastaProcessados, '2026-11-18 20-00-00.mp4'), 'xx');
  fs.mkdirSync(path.join(c.pastaSaida, '2026-11-18 20-00-00'), { recursive: true });
  fs.writeFileSync(path.join(c.pastaSaida, '2026-11-18 20-00-00', 'sessao.json'), JSON.stringify({ sessao: '2026-11-18 20-00-00', criadoEm: '2026-11-18', duracao: 600, cortes: [{ arquivo: 'a.mp4', status: 'aguardando' }, { arquivo: 'b.mp4', status: 'aprovado' }] }));
  fs.writeFileSync(path.join(c.pastaRoteiros, 'ideia.md'), '# Dá pra desentupir pia no GTA 6\n\ngancho...');
  fs.writeFileSync(path.join(c.pastaRoteiros, 'live.json'), JSON.stringify({ titulo: 'Live de sábado', tipo: 'live', texto: 'roteiro' }));
  const pr = path.join(c.pastaEntrega, 'principal', 's_01');
  fs.mkdirSync(pr, { recursive: true });
  fs.writeFileSync(path.join(pr, 'post.json'), JSON.stringify({ titulo: 'T', criadoEm: '2026-11-19', linha: { redes: ['tiktok'] } }));
  const pr2 = path.join(c.pastaEntrega, 'principal', 's_02');
  fs.mkdirSync(pr2, { recursive: true });
  fs.writeFileSync(path.join(pr2, 'post.json'), JSON.stringify({ titulo: 'U', criadoEm: '2026-11-18' }));
  fs.writeFileSync(path.join(pr2, 'postado.json'), JSON.stringify({ em: '2026-11-19T12:00:00Z', links: { tiktok: 'https://tiktok.com/x' } }));
  return c;
}

test('brutos: na fila e processado, com os cortes da sessão', () => {
  const c = montar();
  const b = listarBrutos(c, { agora: Date.parse('2026-11-19T12:00:00Z') });
  assert.equal(b.find((x) => x.nome === 'nova.mp4').status, 'na fila');
  const p = b.find((x) => x.onde === 'gravacoes');
  assert.equal(p.status, 'processado');
  assert.equal(p.cortes, 2);
  assert.equal(listarBrutos(c, { agora: Date.parse('2026-11-19T10:00:10Z') }).find((x) => x.nome === 'nova.mp4').status, 'gravando');
});

test('roteiros, prontos e redes sem métricas', () => {
  const c = montar();
  const r = listarRoteiros(c);
  assert.deepEqual(r.map((x) => x.titulo).sort(), ['Dá pra desentupir pia no GTA 6', 'Live de sábado']);
  const p = listarProntos(c);
  assert.equal(p.find((x) => x.titulo === 'U').status, 'postado');
  assert.equal(p.find((x) => x.titulo === 'T').status, 'esperando a postagem');
  const redes = lerRedes(c);
  assert.equal(redes.contas.length, 2);
  assert.ok(redes.contas.every((x) => !x.conectada));
  fs.writeFileSync(c.arquivoMetricas, JSON.stringify({ atualizadoEm: 'x', contas: [{ rede: 'tiktok', linha: 'principal', nome: 'FNANDO', seguidores: 120, views7d: 3000 }] }));
  const r2 = lerRedes(c);
  assert.equal(r2.total.seguidores, 120);
  assert.equal(r2.contas.filter((x) => x.conectada).length, 1);
  assert.equal(r2.contas.length, 2);
  const s = resumo({ brutos: listarBrutos(c, { agora: Date.parse('2026-11-19T12:00:00Z') }), sessoes: [{ cortes: [{ status: 'aguardando' }] }], roteiros: r, prontos: p, redes: r2 });
  assert.equal(s.aguardando, 1); assert.equal(s.brutosNaFila, 1); assert.equal(s.postados, 1); assert.equal(s.seguidores, 120);
});

test('nome do envio: só vídeo, sem caminho, sem sobrescrever', () => {
  assert.equal(nomeDeEnvio('../../etc/passwd'), null);
  assert.equal(nomeDeEnvio('.escondido.mp4'), null);
  assert.equal(nomeDeEnvio('gta.mp4', ['gta.mp4', 'gta (2).mp4']), 'gta (3).mp4');
  assert.equal(nomeDeEnvio('Minha gravação.MOV'), 'Minha gravação.MOV');
  assert.equal(pastaDaGravacao('2026-11-19 07-56-04.mp4'), '2026-11-19 07-56-04');
});

test('servidor: central, envio para a pasta do OBS', async () => {
  const c = montar();
  const srv = criarPainel(c).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.match(await (await fetch(`${base}/`)).text(), /Central/);
    assert.match(await (await fetch(`${base}/cortes`)).text(), /Aprovar|Cortes/);
    const d = await (await fetch(`${base}/api/central`)).json();
    assert.equal(d.resumo.aguardando, 1);
    const r = await fetch(`${base}/api/enviar?nome=clipe.mp4`, { method: 'POST', body: Buffer.alloc(5000, 1) });
    assert.equal(r.status, 200);
    assert.equal(fs.statSync(path.join(c.pastaEntrada, 'clipe.mp4')).size, 5000);
    assert.equal((await fetch(`${base}/api/enviar?nome=x.exe`, { method: 'POST', body: 'a' })).status, 400);
    assert.ok(!fs.readdirSync(c.pastaEntrada).some((f) => f.startsWith('.envio')));
  } finally { srv.close(); }
});

import { configDoArquivo } from '../src/observador.js';
test('ao vivo: bloco dá 2 cortes sem vídeo longo; replay dá 1', () => {
  const base = { cortesPorSessao: 6, videoLongo: true, whisper: { modelo: 'turbo' }, aoVivo: { ligado: true, cortesPorBloco: 2, whisper: { modelo: 'small' } } };
  const b = configDoArquivo('2026-11-19 20-05-00.mp4', base);
  assert.equal(b.cortesPorSessao, 2); assert.equal(b.videoLongo, false); assert.equal(b.whisper.modelo, 'small');
  assert.equal(configDoArquivo('Replay 2026-11-19 20-10-00.mp4', base).cortesPorSessao, 1);
  assert.equal(configDoArquivo('x.mp4', { ...base, aoVivo: { ligado: false } }).cortesPorSessao, 6);
});
