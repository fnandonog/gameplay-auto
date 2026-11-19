import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPalavroes, mascarar, adesivosDe, assAdesivos, escolherMusica, estrelaPath } from '../src/efeitos.js';
import { argsCorte } from '../src/corte.js';

const w = (text, start, end = start + 0.3) => ({ text, start, end });

test('heavy profanity is masked and beeped; mild only with todos', () => {
  const ws = [w('olha', 0), w('essa', 0.4), w('Caralho!', 0.8, 1.2), w('porra', 1.5, 1.8), w('mano', 2)];
  const r = filtrarPalavroes(ws);
  assert.equal(r.palavras[2].text, 'C******!');
  assert.equal(r.palavras[3].text, 'porra');
  assert.deepEqual(r.bips, [[0.76, 1.24]]);
  const t = filtrarPalavroes(ws, { nivel: 'todos' });
  assert.equal(t.palavras[3].text, 'p****');
  assert.equal(t.bips.length, 2);
  assert.equal(filtrarPalavroes(ws, { nivel: false }).bips.length, 0);
  assert.equal(mascarar('fdp'), 'f**');
});

test('close beeps merge, accents ignored', () => {
  const r = filtrarPalavroes([w('filho', 0), w('da', 0.3), w('PUTA', 0.5, 0.8), w('arrombado', 0.85, 1.4), w('fodasse', 3, 3.4)]);
  assert.deepEqual(r.bips, [[0.46, 1.44], [2.96, 3.44]]);
});

test('police and money words pop stars and $$$, spaced and not in the hook or end card', () => {
  const ws = [w('polícia', 0.5), w('a', 2), w('polícia', 2.5), w('chegou', 3), w('o', 5), w('dinheiro', 9), w('policial', 10), w('grana', 19)];
  assert.deepEqual(adesivosDe(ws, 20), [{ tipo: 'procurado', t: 2.5 }, { tipo: 'grana', t: 9 }]);
  assert.deepEqual(adesivosDe([w('cara', 3), w('comprar', 4)], 20).map((a) => a.tipo), ['grana']);
  const lines = assAdesivos([{ tipo: 'procurado', t: 2.5 }, { tipo: 'grana', t: 9 }], { W: 1080, H: 1920, seam: 1380 });
  assert.equal(lines.length, 6);
  assert.match(lines[0], /\\p1\}m \d+ \d+ l /);
  assert.match(lines[5], /\$\$\$/);
  assert.equal(estrelaPath(64).split(' ').length, 22);
});

test('music: off when the folder is empty, stable choice per cut', () => {
  const lista = () => ['b.mp3', 'a.m4a', 'nota.txt'];
  assert.equal(escolherMusica('x', { pasta: '/m' }, () => []), null);
  assert.equal(escolherMusica('x', { pasta: '/m', ligado: false }, lista), null);
  const a = escolherMusica('corte-1', { pasta: '/m' }, lista);
  assert.ok(['/m/a.m4a', '/m/b.mp3'].includes(a));
  assert.equal(escolherMusica('corte-1', { pasta: '/m' }, lista), a);
});

test('argsCorte mutes the beep ranges, adds the beep and ducks the music', () => {
  const a = argsCorte({ jogo: 'j.mp4', camera: 'j.mp4', start: 10, end: 30, ass: 'x.ass', out: 'o.mp4', formato: 'jogocheio', bips: [[1, 1.5], [4, 4.3]], musica: { arquivo: 'm.mp3', volume: 0.1 }, encoder: 'libx264' });
  const fc = a[a.indexOf('-filter_complex') + 1];
  assert.match(fc, /volume='if\(between\(t,1,1.5\)\+between\(t,4,4.3\),0,1\)':eval=frame/);
  assert.match(fc, /sidechaincompress/);
  assert.match(fc, /amix=inputs=3/);
  assert.ok(a.includes('sine=frequency=1000:sample_rate=48000'));
  assert.equal(a[a.indexOf('m.mp3') - 5], '-stream_loop');
  const sem = argsCorte({ jogo: 'j.mp4', camera: 'j.mp4', start: 10, end: 30, ass: 'x.ass', out: 'o.mp4', formato: 'jogocheio', encoder: 'libx264' });
  assert.match(sem[sem.indexOf('-filter_complex') + 1], /\[a0\]apad=whole_dur=20,atrim=end=20\[a\]/);
});

import { trechosDaGravacao, seg } from '../src/trechos.js';
import { aplicarDecisoes } from '../src/ia.js';
test('owner stretches become required cuts even when the AI skips them', () => {
  assert.equal(seg('29:15'), 1755);
  assert.equal(seg('1:00:05'), 3605);
  const t = trechosDaGravacao([{ gravacao: '2026-11-19 09-35-27', de: '29:15', ate: '30:05', gancho: 'ACHEI UM PS5 DENTRO DO GTA 6' }, { gravacao: '2026-11-19 07-56-04', de: '1:00', ate: '1:30' }], '2026-11-19 09-35-27', 2460);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].start, t[0].end, t[0].obrigatorio], [1755, 1805, true]);
  const pulou = aplicarDecisoes(t, [{ id: 0, usar: false, inicio: 1760, fim: 1800, nota: 5, gancho: 'X', titulo: 'Y', descricao: '', hashtags: [], serie: '' }]);
  assert.equal(pulou.length, 1);
  const sumiu = aplicarDecisoes(t, []);
  assert.equal(sumiu[0].gancho, 'ACHEI UM PS5 DENTRO DO GTA 6');
});

import { impactosDe, marcarEnfase, zoomDosImpactos } from '../src/efeitos.js';
test('reaction words: rare hits, two-word reactions, caption emphasis and gentle zoom', () => {
  const ws = [w('olha', 0.2), w('que', 1), w('isso', 1.3), w('caraca', 2), w('nossa', 3), w('é', 6), w('bizarro', 7), w('caramba', 12), w('insano', 21)];
  const imp = impactosDe(ws, 30);
  assert.deepEqual(imp.map((m) => m.t), [1, 12]);
  const m = marcarEnfase(ws, imp);
  assert.ok(m[1].enfase && m[2].enfase && m[7].enfase && !m[6].enfase);
  assert.equal(zoomDosImpactos([1], 60), '1+0.06*min(1,max(0,1-abs(in/60-1.10)/0.35))');
  assert.equal(zoomDosImpactos([], 60), null);
});
