import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { limparEdicao, opcoesDaEdicao, nomeVersao, pedirAjuste, refazerCorte } from '../src/refazer.js';
import { editarCorte } from '../src/painel.js';

test('quick edit: cleaned options and what the render gets', () => {
  assert.deepEqual(limparEdicao({ formato: 'jogo', arroba: false, selo: ' GTA 6 {x}', lixo: 1 }), { formato: 'jogo', arroba: false, selo: 'GTA 6 x' });
  assert.deepEqual(limparEdicao({ formato: 'nada' }), {});
  const m = { arroba: '@fnando.gameplay', chamada: 'SEGUE', cor: '#FFE600' };
  const o = opcoesDaEdicao({ formato: 'meio', parte: 2 }, { arroba: false, chamada: false, selo: 'gta 6' }, m);
  assert.equal(o.formato, 'meio'); assert.equal(o.marca.arroba, ''); assert.equal(o.marca.chamada, false); assert.equal(o.selo, 'GTA 6');
  assert.equal(m.arroba, '@fnando.gameplay'); // the line's brand is not changed
  assert.equal(opcoesDaEdicao({ formato: 'meio', parte: 2 }, {}, m).selo, 'PARTE 2');
});

test('a new version never overwrites a file', () => {
  assert.equal(nomeVersao('01-pia-meio.mp4', 'jogo'), '01-pia-jogo-v2.mp4');
  const tem = new Set(['01-pia-meio-v2.mp4']);
  assert.equal(nomeVersao('01-pia-meio-v2.mp4', 'meio', (n) => tem.has(n)), '01-pia-meio-v3.mp4');
});

function sessao() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'refazer-'));
  fs.mkdirSync(path.join(base, 's1'));
  fs.writeFileSync(path.join(base, 's1', 'sessao.json'), JSON.stringify({ gravacao: '/g/cena.mp4', jogo: '/g/cena.mp4', camera: '/g/cena.mp4',
    cortes: [{ arquivo: '01-pia-meio.mp4', formato: 'meio', variantes: { meio: '01-pia-meio.mp4', jogo: '01-pia-jogo.mp4' }, inicio: 10, fim: 30, linha: 'fnando', status: 'aguardando', titulo: 'Pia' }] }));
  fs.writeFileSync(path.join(base, 's1', 'transcricao.json'), JSON.stringify([{ text: 'olha', start: 11, end: 11.5 }]));
  return base;
}

test('Pedir ajuste keeps the note and holds the cut out of posting', () => {
  const base = sessao();
  const c = pedirAjuste(base, { pasta: 's1', arquivo: '01-pia-meio.mp4', texto: 'som atrasado' });
  assert.equal(c.status, 'ajuste'); assert.equal(c.ajustes[0].texto, 'som atrasado');
  assert.throws(() => pedirAjuste(base, { pasta: 's1', arquivo: '01-pia-meio.mp4', texto: ' ' }));
  assert.equal(editarCorte(base, { pasta: 's1', arquivo: '01-pia-meio.mp4', status: 'aprovado' }).status, 'aprovado');
});

test('redo renders a new file with the edit and puts the cut back in review', async () => {
  const base = sessao();
  pedirAjuste(base, { pasta: 's1', arquivo: '01-pia-meio.mp4', texto: 'sem câmera' });
  let job = null;
  const render = async (j) => { job = j; fs.writeFileSync(j.out, 'x'); return j.out; };
  const config = { pastaSaida: base, linhas: [{ id: 'fnando', arroba: '@fnando.gameplay' }] };
  const r = refazerCorte(config, { pasta: 's1', arquivo: '01-pia-meio.mp4', edicao: { formato: 'jogo', selo: 'GTA 6', arroba: false } }, { render, fazerCapa: async () => null, log: () => {} });
  assert.throws(() => refazerCorte(config, { pasta: 's1', arquivo: '01-pia-meio.mp4', edicao: {} }, { render }), /já está sendo refeito/);
  await r.fila;
  assert.equal(job.formato, 'jogo'); assert.equal(job.selo, 'GTA 6'); assert.equal(job.start, 10); assert.equal(job.audio, '/g/cena.mp4'); assert.equal(job.palavras.length, 1);
  const s = JSON.parse(fs.readFileSync(path.join(base, 's1', 'sessao.json'), 'utf8')).cortes[0];
  assert.equal(s.arquivo, '01-pia-jogo-v2.mp4'); assert.equal(s.formato, 'jogo'); assert.equal(s.status, 'aguardando');
  assert.equal(s.refazendo, undefined); assert.equal(s.ajustes[0].feito, true); assert.equal(s.versoes[0].arquivo, '01-pia-meio.mp4');
});

test('a session without a camera cannot be redone with the camera', () => {
  const base = sessao();
  assert.throws(() => refazerCorte({ pastaSaida: base }, { pasta: 's1', arquivo: '01-pia-meio.mp4', edicao: { formato: 'meio' } }), /não tem câmera/);
});
