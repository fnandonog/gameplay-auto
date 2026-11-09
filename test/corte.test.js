import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsCorte, layoutDe } from '../src/corte.js';
import { assOf, cuesOf, wrap } from '../src/legenda.js';
import { palavrasDoWhisper, palavrasEntre } from '../src/transcricao.js';
import { aplicarDecisoes } from '../src/ia.js';
import { arquivosDaSessao, ehArquivoExtra } from '../src/sessao.js';
import { PADRAO } from '../src/config.js';
import { prontos } from '../src/observador.js';

test('layout padrão: câmera 768 px em cima, jogo 1152 embaixo', () => {
  assert.deepEqual(layoutDe(0.4), { W: 1080, H: 1920, camH: 768, gameH: 1152, seam: 768 });
});

test('arquivos separados usam três entradas; cena única usa split', () => {
  const sep = argsCorte({ jogo: '/g.mp4', camera: '/c.mp4', start: 10, end: 40, ass: '/x.ass', out: '/o.mp4' });
  assert.equal(sep.filter((a) => a === '-i').length, 3);
  const comCena = argsCorte({ jogo: '/g.mp4', camera: '/c.mp4', audio: '/s.mp4', start: 10, end: 40, ass: '/x.ass', out: '/o.mp4' }).join(' ');
  assert.match(comCena, /\[2:a:0\]afade/);
  assert.match(comCena, /\[st\]\[3:v\]overlay/);
  assert.match(sep.join(' '), /\[1:v\]crop/);
  const cena = argsCorte({ jogo: '/s.mp4', camera: '/s.mp4', start: 10, end: 40, ass: '/x.ass', out: '/o.mp4', regiaoCamera: { x: 1440, y: 780, w: 480, h: 300 } });
  assert.equal(cena.filter((a) => a === '-i').length, 2);
  assert.match(cena.join(' '), /split=2/);
  assert.match(cena.join(' '), /crop=480:300:1440:780/);
});

test('legenda: palavra por palavra na linha entre câmera e jogo, gancho no topo', () => {
  const words = [{ text: 'não', start: 0, end: 0.3 }, { text: 'acredito!', start: 0.3, end: 0.9 }, { text: 'olha', start: 1.2, end: 1.5 }];
  const cues = cuesOf(words);
  assert.equal(cues.length, 2);
  const ass = assOf(cues, { layout: layoutDe(), hook: 'ele não esperava essa jogada' });
  assert.match(ass, /\\pos\(540,768\)/);
  assert.match(ass, /\{\\kf30\}NÃO \{\\kf60\}ACREDITO!/);
  assert.match(ass, /Gancho,,0,0,0,,\{\\fad\(0,250\)\}ELE NÃO ESPERAVA\\NESSA JOGADA/);
  assert.equal(wrap('a b c'), 'a b c');
});

test('whisper: uma palavra por segmento, ignora [BLANK_AUDIO], pontuação gruda', () => {
  const w = palavrasDoWhisper({ transcription: [
    { offsets: { from: 0, to: 300 }, text: ' Caraca' }, { offsets: { from: 300, to: 350 }, text: '!' },
    { offsets: { from: 400, to: 900 }, text: ' [BLANK_AUDIO]' }, { offsets: { from: 1000, to: 1400 }, text: ' mano' },
  ] });
  assert.deepEqual(w.map((x) => x.text), ['Caraca!', 'mano']);
  assert.deepEqual(palavrasEntre(w, 0.9, 2).map((x) => [x.text, +x.start.toFixed(2)]), [['mano', 0.1]]);
});

test('decisão da IA fica dentro da janela e com pelo menos 15 s', () => {
  const cands = [{ start: 100, end: 160, nota: 5, motivo: 'x' }, { start: 300, end: 340, nota: 5, motivo: 'y' }];
  const out = aplicarDecisoes(cands, [
    { id: 0, usar: true, inicio: 90, fim: 200, nota: 8, gancho: 'g', titulo: 't', descricao: 'd', hashtags: [] },
    { id: 1, usar: false, inicio: 300, fim: 330, nota: 2, gancho: '', titulo: '', descricao: '', hashtags: [] },
    { id: 0, usar: true, inicio: 150, fim: 151, nota: 7, gancho: 'g', titulo: 't', descricao: 'd', hashtags: [] },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].start, out[0].end], [100, 160]);
  assert.deepEqual([out[1].start, out[1].end], [145, 160]);
});

test('reconhece os arquivos do Source Record da mesma sessão', () => {
  const nomes = ['2026-11-09 21-30-00.mp4', '2026-11-09 21-30-00 camera.mp4', '2026-11-09 21-30-00 jogo.mp4', '2026-11-09 22-00-00.mp4'];
  const a = arquivosDaSessao('/in/2026-11-09 21-30-00.mp4', nomes, PADRAO);
  assert.equal(a.separados, true);
  assert.equal(a.camera, '/in/2026-11-09 21-30-00 camera.mp4');
  assert.equal(ehArquivoExtra('2026-11-09 21-30-00 jogo.mp4', nomes), true);
  assert.equal(ehArquivoExtra('2026-11-09 22-00-00.mp4', nomes), false);
  assert.equal(arquivosDaSessao('/in/2026-11-09 22-00-00.mp4', nomes, PADRAO).separados, false);
});

test('gravação só fica pronta quando o tamanho para de mudar', () => {
  const desde = {};
  assert.deepEqual(prontos({ a: 10 }, {}, desde, 0, 30000), []);
  assert.deepEqual(prontos({ a: 10 }, { a: 10 }, desde, 20000, 30000), []);
  assert.deepEqual(prontos({ a: 10 }, { a: 10 }, desde, 31000, 30000), ['a']);
  assert.deepEqual(prontos({ a: 20 }, { a: 10 }, desde, 40000, 30000), []);
});
