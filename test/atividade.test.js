import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aplicarEvento, lerAtividade, quadroEscritorio, registrar } from '../src/atividade.js';
import { criarPainel } from '../src/painel.js';
import { LINHAS_SUGERIDAS } from '../src/canais.js';

test('evento muda o estado do agente; agente ou estado desconhecido é ignorado', () => {
  let s = aplicarEvento({}, { agente: 'editor', estado: 'trabalhando', texto: 'corte 1', em: 'x' });
  s = aplicarEvento(s, { agente: 'intruso', estado: 'trabalhando', em: 'x' });
  s = aplicarEvento(s, { agente: 'editor', estado: 'dançando', em: 'x' });
  assert.equal(s.agentes.editor.estado, 'trabalhando');
  assert.equal(s.eventos.length, 1);
});

test('registrar grava no disco e guarda só os últimos eventos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ativ-'));
  for (let i = 0; i < 130; i++) registrar(dir, 'escriba', 'trabalhando', `n${i}`);
  const a = lerAtividade(dir);
  assert.equal(a.eventos.length, 120);
  assert.equal(a.agentes.escriba.texto, 'n129');
  fs.writeFileSync(path.join(dir, 'arquivo'), '');
  registrar(path.join(dir, 'arquivo', 'sub'), 'escriba', 'erro', 'x'); // never throws (a file is in the way)
});

test('quadro: revisor conta o que espera aprovação, trabalho velho vira parado, filas por linha', () => {
  const agora = Date.parse('2026-11-10T12:00:00Z');
  const atividade = { agentes: { editor: { estado: 'trabalhando', texto: 'corte', em: '2026-11-10T01:00:00Z' } }, eventos: [] };
  const sessoes = [{ cortes: [{ status: 'aguardando', linha: 'principal' }, { status: 'agendado', linha: 'shorts', agendadoPara: '2026-11-10T15:00:00Z' }] }];
  const q = quadroEscritorio({ atividade, sessoes, linhas: LINHAS_SUGERIDAS, agora });
  const ag = Object.fromEntries(q.agentes.map((a) => [a.id, a]));
  assert.equal(ag.revisor.estado, 'esperando');
  assert.equal(ag.editor.estado, 'parado');
  assert.match(ag.clipador.texto, /permissão/);
  assert.equal(q.filas.find((f) => f.id === 'shorts').proximo, '2026-11-10T15:00:00Z');
  assert.equal(q.totais.aguardando, 1);
});

test('servidor entrega o escritório, os dados e a marca', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-'));
  registrar(dir, 'vigia', 'esperando', 'De olho');
  const srv = criarPainel({ pastaSaida: dir, linhas: LINHAS_SUGERIDAS }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.match(await (await fetch(`${base}/escritorio`)).text(), /<canvas/);
    const q = await (await fetch(`${base}/api/escritorio`)).json();
    assert.equal(q.agentes.find((a) => a.id === 'vigia').estado, 'esperando');
    assert.equal(q.filas.length, 5);
    assert.equal((await fetch(`${base}/marca/fnando-simbolo.svg`)).headers.get('content-type'), 'image/svg+xml');
    assert.equal((await fetch(`${base}/marca/..%2Fpainel.html`)).status, 404);
    const r = await fetch(`${base}/api/corte`, { method: 'POST', body: JSON.stringify({ pasta: 'x', arquivo: 'y', linha: 'nada' }) });
    assert.equal(r.status, 400);
  } finally { srv.close(); }
});
