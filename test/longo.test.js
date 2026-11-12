import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitulos, filtrosSelecao, mapearTempo, segmentosLongos } from '../src/longo.js';

const w = (s, e) => ({ text: 'x', start: s, end: e });

test('silêncio longo encolhe para 2 s de cada lado; curto fica', () => {
  const segs = segmentosLongos({ words: [w(0, 5), w(10, 15), w(100, 105)], duracao: 110 });
  assert.deepEqual(segs, [{ start: 0, end: 17 }, { start: 98, end: 110 }]);
});

test('o momento fica inteiro e o silêncio em volta dele encolhe', () => {
  const segs = segmentosLongos({ words: [w(0, 5), w(100, 105)], duracao: 110, protegidos: [{ start: 40, end: 70 }] });
  assert.deepEqual(segs, [{ start: 0, end: 7 }, { start: 38, end: 72 }, { start: 98, end: 110 }]);
  const curto = segmentosLongos({ words: [w(0, 5), w(40, 45)], duracao: 50, protegidos: [{ start: 10, end: 30 }] });
  assert.deepEqual(curto, [{ start: 0, end: 50 }]);
});

test('mapeia o tempo da sessão para o vídeo editado', () => {
  const segs = [{ start: 0, end: 17 }, { start: 98, end: 110 }];
  assert.equal(mapearTempo(100, segs, 10), 10 + 17 + 2);
  assert.equal(mapearTempo(50, segs, 10), null);
});

test('capítulos começam em 0:00 e só saem com pelo menos 3', () => {
  const segs = [{ start: 0, end: 600 }];
  const caps = capitulos([{ start: 120, titulo: 'Golaço' }, { start: 125, titulo: 'perto demais' }, { start: 400, titulo: 'Virada' }], segs, 10);
  assert.deepEqual(caps, ['0:00 Melhor momento (prévia)', '0:10 Começo da partida', '2:10 Golaço', '6:50 Virada']);
  assert.deepEqual(capitulos([], segs, 0), []);
});

test('seleção exata dos trechos mantidos, em uma passada', () => {
  const f = filtrosSelecao([{ start: 0, end: 17 }, { start: 90, end: 100.5 }]);
  assert.equal(f.vf, "select='between(t,0.000,17.000)+between(t,90.000,100.500)',setpts=N/FRAME_RATE/TB");
  assert.equal(f.af, "aselect='between(t,0.000,17.000)+between(t,90.000,100.500)',asetpts=N/SR/TB");
});
