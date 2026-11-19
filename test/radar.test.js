import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatosDoRadar, normalizarItem } from '../src/radar.js';
import { mesclar } from '../src/momentos.js';

const w = (txt, t0) => txt.split(' ').map((word, i) => ({ word, start: t0 + i * 0.5, end: t0 + i * 0.5 + 0.4 }));
const item = { id: 'ovo', titulo: 'Ovo na torre', palavras_chave: ['ovo', 'ninho', 'torre de rádio', 'egg'], titulo_short: 'Subi numa torre pra fazer ISSO', prioridade: 1 };

test('normalizarItem splits words and phrases from palavras_chave', () => {
  const n = normalizarItem(item);
  assert.deepEqual(n.palavras, ['ovo', 'ninho', 'egg']);
  assert.deepEqual(n.frases, ['torre de rádio']);
  assert.equal(n.tituloSugerido, 'Subi numa torre pra fazer ISSO');
});

test('a phrase is enough; one loose word is not; two words close together are', () => {
  assert.equal(candidatosDoRadar(w('subindo na torre de radio agora', 100), [item]).length, 1);
  assert.equal(candidatosDoRadar(w('comprei um ovo frito', 100), [item]).length, 0);
  const c = candidatosDoRadar([...w('olha um ninho', 200), ...w('tem ovo aqui', 210)], [item]);
  assert.equal(c.length, 1);
  assert.equal(c[0].radar, 'ovo');
  assert.ok(c[0].nota >= 8.5);
  assert.match(c[0].motivo, /Subi numa torre/);
});

test('one window per mention, and the radar id survives merging', () => {
  const words = [...w('torre de radio', 100), ...w('torre de radio', 110)];
  const c = candidatosDoRadar(words, [item]);
  assert.equal(c.length, 1);
  const m = mesclar([{ start: 90, end: 120, nota: 6, motivo: 'pico' }, ...c]);
  assert.equal(m[0].radar, 'ovo');
});
