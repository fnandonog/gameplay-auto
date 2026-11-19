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

import { numerarSeries } from '../src/series.js';
test('séries: cada série tem sua numeração, o melhor corte pega o número menor', () => {
  const cs = [{ serie: 'Dicas de GTA 6', nota: 8, titulo: 'B', descricao: 'b?' }, { serie: 'Dicas de GTA 6', nota: 9, titulo: 'A', descricao: 'a?' }, { serie: '', titulo: 'C' }];
  const n = numerarSeries(cs, { 'dicas de gta 6': 2 });
  assert.equal(n['dicas de gta 6'], 4);
  assert.equal(cs[1].parte, 3); assert.equal(cs[0].parte, 4); assert.equal(cs[2].parte, undefined);
  assert.equal(cs[1].titulo, 'A (Parte 3)');
});

import { entregarAprovados } from '../src/entrega.js';
test('missões: aparecem, aprovam e são entregues para o YouTube', async () => {
  const c = montar();
  const pasta = path.join(c.pastaSaida, '2026-11-18 20-00-00');
  fs.mkdirSync(path.join(pasta, 'missoes'));
  fs.writeFileSync(path.join(pasta, 'missoes', '01-m.mp4'), 'v'); fs.writeFileSync(path.join(pasta, 'missoes', '01-m.jpg'), 'j');
  const s = JSON.parse(fs.readFileSync(path.join(pasta, 'sessao.json'), 'utf8'));
  s.missoes = [{ arquivo: 'missoes/01-m.mp4', thumb: 'missoes/01-m.jpg', missao: 'Aluguel', titulo: 'GTA 6: missão do aluguel', descricao: '00:00 início', status: 'aguardando' }];
  fs.writeFileSync(path.join(pasta, 'sessao.json'), JSON.stringify(s));
  const srv = criarPainel(c).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/midia/2026-11-18%2020-00-00/missoes/01-m.mp4`)).status, 200);
    assert.equal((await fetch(`${base}/midia/2026-11-18%2020-00-00/missoes/../sessao.json`)).status, 404);
    const r = await fetch(`${base}/api/corte`, { method: 'POST', body: JSON.stringify({ pasta: '2026-11-18 20-00-00', arquivo: 'missoes/01-m.mp4', status: 'aprovado' }) });
    assert.equal(r.status, 200);
    assert.equal((await (await fetch(`${base}/api/central`)).json()).resumo.longos, 1);
  } finally { srv.close(); }
  entregarAprovados(c, { log: () => {} });
  const d = fs.readdirSync(path.join(c.pastaEntrega, 'youtube-longo'));
  const post = JSON.parse(fs.readFileSync(path.join(c.pastaEntrega, 'youtube-longo', d[0], 'post.json'), 'utf8'));
  assert.equal(post.missao, 'Aluguel'); assert.ok(post.agendarPara);
  assert.ok(fs.existsSync(path.join(c.pastaEntrega, 'youtube-longo', d[0], 'capa.jpg')));
});

import { montarMissoes } from '../src/missoes.js';
test('missões: início abre, fim ou próximo início fecha, curta cai, nudez vira aviso', () => {
  const ev = [{ t: 100, tipo: 'inicio', missao: 'Aluguel' }, { t: 130, tipo: 'inicio', missao: 'aluguel' }, { t: 520, tipo: 'sensivel', missao: 'nudez' },
    { t: 700, tipo: 'fim', missao: 'Aluguel' }, { t: 900, tipo: 'inicio', missao: 'Curta' }, { t: 950, tipo: 'inicio', missao: 'Roubo' }];
  const m = montarMissoes(ev, 1400);
  assert.deepEqual(m.map((x) => x.missao), ['Aluguel', 'Roubo']);
  assert.equal(m[0].inicio, 95); assert.equal(m[0].fim, 705); assert.equal(m[1].fim, 1400);
  assert.equal(m[0].avisos.length, 1);
});

test('missões: tentativa abandonada ou reiniciada é descartada; a que fica aberta no fim é incompleta', () => {
  const ev = [{ t: 100, tipo: 'inicio', missao: 'Aluguel' }, { t: 400, tipo: 'inicio', missao: 'Aluguel' }, { t: 800, tipo: 'fim', missao: 'Aluguel' },
    { t: 900, tipo: 'inicio', missao: 'Roubo' }, { t: 1300, tipo: 'falha', missao: 'Roubo' }, { t: 1400, tipo: 'inicio', missao: 'Barco' }];
  const m = montarMissoes(ev, 2000);
  assert.deepEqual(m.map((x) => [x.missao, x.inicio, !!x.incompleta]), [['Aluguel', 395, false], ['Barco', 1395, true]]);
  assert.deepEqual(m.descartados.map((d) => [d.missao, d.inicio, d.fim, d.motivo]), [['Aluguel', 95, 395, 'reiniciou a missão'], ['Roubo', 895, 1305, 'missão fracassada ou abandonada']]);
});

import { subtrair } from '../src/longo.js';
test('vídeo longo: os trechos descartados saem dos segmentos', () => {
  assert.deepEqual(subtrair([{ start: 0, end: 100 }, { start: 200, end: 300 }], [{ inicio: 50, fim: 250 }]), [{ start: 0, end: 50 }, { start: 250, end: 300 }]);
});

import { salvarCredenciais, aplicarChaveIa } from '../src/credenciais.js';
test('chave da IA colada na central vai para o processo e recusa o que não é chave', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-'));
  const f = path.join(dir, '.credenciais.json');
  assert.throws(() => salvarCredenciais(f, 'ia', { apiKey: 'abc' }), /sk-ant-/);
  salvarCredenciais(f, 'ia', { apiKey: 'sk-ant-api03-' + 'x'.repeat(30) });
  const env = {};
  assert.equal(aplicarChaveIa(f, env), true);
  assert.match(env.ANTHROPIC_API_KEY, /^sk-ant-/);
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
});

import { removerAlucinacoes } from '../src/transcricao.js';
test('legenda: tira os créditos que o Whisper inventa e as repetições em loop', () => {
  const w = (txt, t0 = 0, gap = 0.4) => txt.split(' ').map((text, i) => ({ text, start: t0 + i * gap, end: t0 + i * gap + 0.3 }));
  const fala = [...w('olha que legal essa pia'), ...w('Legendado por Sônia Ruberti', 5), ...w('vamos lá', 10)];
  assert.equal(removerAlucinacoes(fala).map((x) => x.text).join(' '), 'olha que legal essa pia vamos lá');
  assert.equal(removerAlucinacoes(w('Legendas pela comunidade Amara.org')).length, 0);
  assert.equal(removerAlucinacoes(w('obrigado por assistir galera')).map((x) => x.text).join(' '), 'galera');
  assert.equal(removerAlucinacoes(w('vai vai vai corre')).length, 4); // single words are not loops
  assert.equal(removerAlucinacoes(w('meu deus meu deus meu deus meu deus')).map((x) => x.text).join(' '), 'meu deus meu deus');
  assert.equal(removerAlucinacoes(w('a legenda por enquanto tá boa')).length, 4); // known risk: "legenda por" itself goes
});

test('conta Claude: prompt with schema and JSON extraction', async () => {
  const { montarPrompt, extrairJson, acharClaude } = await import('../src/contaClaude.js');
  const p = montarPrompt({ system: 'S', messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }, { type: 'image', source: { data: '', media_type: 'image/jpeg' } }] }], output_config: { format: { schema: { type: 'object' } } } }, () => '/tmp/a.jpg');
  assert.match(p, /S\n\noi\n\n\[imagem: leia o arquivo \/tmp\/a\.jpg\]/);
  assert.match(p, /JSON Schema/);
  assert.equal(extrairJson('ok:\n```json\n{"a":[1]}\n```'), '{"a":[1]}');
  assert.throws(() => extrairJson('sem json'));
  assert.equal(acharClaude({ CLAUDE_BIN: '/x/claude' }), '/x/claude');
  assert.equal(acharClaude({ PATH: '/nada' }, () => false), null);
});

test('postar agora: jumps the queue', async () => {
  const { proximoEnvio } = await import('../src/postador.js');
  const mk = (id, ag, ja) => ({ id, post: { agendarPara: ag, postarJa: ja, linha: { redes: ['youtube'] } }, postado: {}, estado: {} });
  const r = proximoEnvio([mk('velho', '2026-11-19T10:00:00Z'), mk('ja', '2026-11-19T16:00:00Z', true)], { agora: Date.parse('2026-11-19T16:01:00Z'), conectadas: ['youtube'] });
  assert.equal(r.post.id, 'ja');
});

test('IA: o token do claude setup-token vai para CLAUDE_CODE_OAUTH_TOKEN, não para a chave de API', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { salvarCredenciais, aplicarChaveIa, lerCredenciais } = await import('../src/credenciais.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cred-')), 'c.json');
  salvarCredenciais(f, 'ia', { apiKey: 'sk-ant-api03-' + 'a'.repeat(30) });
  salvarCredenciais(f, 'ia', { apiKey: 'sk-ant-oat01-' + 'b'.repeat(30) });
  const c = lerCredenciais(f).ia;
  assert.equal(c.apiKey, undefined);
  assert.match(c.oauthToken, /^sk-ant-oat01-/);
  const env = {};
  assert.equal(aplicarChaveIa(f, env), true);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.match(env.CLAUDE_CODE_OAUTH_TOKEN, /^sk-ant-oat01-/);
});
