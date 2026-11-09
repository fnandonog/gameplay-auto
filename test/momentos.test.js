import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acharFrases, candidatos, COMANDOS, escolher, mesclar, parseVolume, picos, zScores } from '../src/momentos.js';

const ws = (txt, t0 = 0, passo = 0.4) => txt.split(' ').map((text, i) => ({ text, start: t0 + i * passo, end: t0 + i * passo + 0.35 }));

test('acha o comando de voz com acento e pontuação', () => {
  const words = ws('nossa que jogada Clipa, isso agora');
  const [c] = acharFrases(words, COMANDOS);
  assert.equal(c.frase, 'clipa isso');
  assert.equal(c.start, words[3].start);
});

test('kkkk e hahaha contam como risada', () => {
  assert.equal(acharFrases(ws('kkkkkk mano'), ['kkk']).length, 1);
  assert.equal(acharFrases(ws('hahahaha'), ['hahaha']).length, 1);
});

test('comando de voz vira corte que termina antes do comando', () => {
  const words = [...ws('bla '.repeat(200).trim()), ...ws('clipa isso', 100)];
  const cs = candidatos({ words, duracao: 300 });
  const c = cs.find((x) => x.fixo);
  assert.ok(c);
  assert.ok(c.end < 100 && c.end > 99);
  assert.equal(Math.round(c.start), 60);
});

test('pico de volume vira candidato', () => {
  const db = Array.from({ length: 300 }, (_, i) => -30 + (i % 7) * 0.5);
  db[150] = -5;
  const z = zScores(db);
  assert.equal(picos(z)[0].t, 150);
  const cs = candidatos({ volMic: db, duracao: 300 });
  assert.ok(cs.some((c) => c.start <= 150 && c.end >= 150));
});

test('janelas sobrepostas se juntam e ficam com a maior nota', () => {
  const m = mesclar([{ start: 0, end: 30, nota: 5, motivo: 'a' }, { start: 20, end: 40, nota: 9, motivo: 'b' }, { start: 100, end: 120, nota: 1, motivo: 'c' }]);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].start, m[0].end, m[0].nota], [0, 40, 9]);
});

test('escolher mantém os marcados mesmo com nota menor', () => {
  const l = [{ start: 0, nota: 3, fixo: true }, { start: 10, nota: 8 }, { start: 20, nota: 7 }, { start: 30, nota: 6 }];
  assert.deepEqual(escolher(l, 2).map((c) => c.start), [0, 10]);
});

test('lê o volume do ffmpeg', () => {
  assert.deepEqual(parseVolume('frame:0\nlavfi.astats.Overall.RMS_level=-23.5\nframe:1\nlavfi.astats.Overall.RMS_level=-inf\n'), [-23.5, -90]);
});

test('trilha constante não gera picos falsos', () => {
  const db = Array.from({ length: 200 }, (_, i) => -41.08 + (i % 3) * 0.01);
  assert.equal(picos(zScores(db)).length, 0);
});
