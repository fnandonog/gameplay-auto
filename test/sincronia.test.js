import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizar, melhorDesvio, pedacos, jaSincronizado } from '../src/sincronia.js';

const PX = 48 * 27;
// a moving random picture: frame i is a deterministic noise pattern
function video(n, semente = 1) {
  const buf = Buffer.alloc(n * PX);
  let x = semente;
  for (let i = 0; i < buf.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; buf[i] = x & 255; }
  return buf;
}

test('the scene window is found at the right lag inside the game file', () => {
  const b = normalizar(video(200));
  const a = b.slice(73, 113);
  assert.equal(melhorDesvio(a, b).lag, 73);
});

test('a still picture (menu, black screen) gives no answer instead of a wrong one', () => {
  const parado = normalizar(Buffer.alloc(40 * PX, 30));
  assert.equal(melhorDesvio(parado, normalizar(video(200))), null);
});

test('a jump in the delay becomes a stretch without game picture, and the end past the game file too', () => {
  const ps = pedacos([{ t: 20, d: 0 }, { t: 50, d: 0.1 }, { t: 80, d: 10, j: 70 }, { t: 110, d: 10 }], 200, 0.25, 180);
  assert.deepEqual(ps, [
    { de: 0, ate: 60, desvio: 0 },
    { de: 60, ate: 70, desvio: null },
    { de: 70, ate: 190, desvio: 10 },
    { de: 190, ate: 200, desvio: null },
  ]);
  assert.equal(jaSincronizado(ps), false);
});

test('a game file that only ends early needs no copy', () => {
  const ps = pedacos([{ t: 20, d: 0 }, { t: 50, d: 0.05 }], 100, 0.25, 98);
  assert.equal(jaSincronizado(ps.filter((x) => x.de < 97)), true);
});
