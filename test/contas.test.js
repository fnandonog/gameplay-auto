import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estadoContas, ondeDaLive, salvarConta, lerContas, GUIA } from '../src/contas.js';

const linhas = [{ id: 'principal', nome: 'Canal', redes: ['youtube', 'instagram', 'tiktok'] }];

test('estadoContas adds the Facebook Page each Instagram needs and follows the checklist', () => {
  const salvo = { contas: { 'principal|youtube': { passos: { email: true } }, 'principal|tiktok': { passos: Object.fromEntries(GUIA.tiktok.passos.map((p) => [p.id, true])) } } };
  const e = estadoContas({ linhas, salvo });
  assert.deepEqual(e.map((c) => c.rede), ['youtube', 'instagram', 'tiktok', 'facebook']);
  assert.equal(e.find((c) => c.rede === 'facebook').soPara, 'instagram');
  assert.equal(e.find((c) => c.rede === 'instagram').precisa, 'principal|facebook');
  assert.equal(e.find((c) => c.rede === 'youtube').status, 'criando');
  assert.equal(e.find((c) => c.rede === 'tiktok').status, 'criada');
  assert.equal(e.find((c) => c.rede === 'instagram').status, 'a criar');
});

test('estadoContas: connected from metricas, reconnect when stale or with an error', () => {
  const agora = Date.parse('2026-11-19T12:00:00Z');
  const fresco = { atualizadoEm: '2026-11-19T10:00:00Z', contas: [{ rede: 'youtube', linha: 'principal', seguidores: 10 }, { rede: 'tiktok', linha: 'principal', erro: 'Token expirou' }] };
  const e = estadoContas({ linhas, metricas: fresco, agora });
  assert.equal(e.find((c) => c.rede === 'youtube').status, 'conectada');
  assert.equal(e.find((c) => c.rede === 'tiktok').status, 'reconectar');
  assert.equal(e.find((c) => c.rede === 'tiktok').motivo, 'Token expirou');
  const velho = estadoContas({ linhas, metricas: { ...fresco, atualizadoEm: '2026-11-15T10:00:00Z' }, agora });
  assert.equal(velho.find((c) => c.rede === 'youtube').status, 'reconectar');
});

test('ondeDaLive: Twitch and YouTube today, TikTok only at 1.000 followers', () => {
  const live = Object.fromEntries(ondeDaLive([{ rede: 'tiktok', seguidores: 999 }]).map((v) => [v.rede, v.pode]));
  assert.equal(live.twitch, true); assert.equal(live.youtube, true); assert.equal(live.tiktok, false);
  assert.equal(ondeDaLive([{ rede: 'tiktok', seguidores: 1000 }]).find((v) => v.rede === 'tiktok').pode, true);
});

test('salvarConta saves ticks, @ and notes, refuses secrets and bad input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contas-'));
  const config = { arquivoMetricas: path.join(dir, 'metricas.json'), linhas };
  salvarConta(config, { chave: 'principal|youtube', passo: 'email', feito: true });
  salvarConta(config, { chave: 'principal|youtube', arroba: 'canal.gta' });
  const r = salvarConta(config, { nova: { nome: 'Dicas', rede: 'twitch' } });
  const yt = r.contas.find((c) => c.chave === 'principal|youtube');
  assert.equal(yt.arroba, '@canal.gta'); assert.equal(yt.feitos, 1);
  assert.ok(r.contas.some((c) => c.chave === 'dicas|twitch'));
  assert.throws(() => salvarConta(config, { chave: 'principal|youtube', nota: 'senha 1234' }), /senha/);
  assert.throws(() => salvarConta(config, { chave: 'principal|youtube', passo: 'nada', feito: true }), /Passo/);
  assert.throws(() => salvarConta(config, { chave: '../x|youtube', passo: 'email' }), /inválida/);
  assert.throws(() => salvarConta(config, { chave: 'principal|youtube', arroba: 'a b' }), /@/);
  assert.equal(lerContas(config).arquivo, path.join(dir, 'contas.json'));
  assert.ok(!fs.readFileSync(path.join(dir, 'contas.json'), 'utf8').includes('1234'));
});
