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
  assert.match(sem[sem.indexOf('-filter_complex') + 1], /\[a0\]anull\[a\]/);
});
