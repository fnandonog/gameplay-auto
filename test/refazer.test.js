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

test('a mic track silent most of the time is flagged', async () => {
  const { micMudo } = await import('../src/momentos.js');
  assert.equal(micMudo([...Array(82).fill(-90), ...Array(18).fill(-40)]), 0.82);
  assert.equal(micMudo(Array(100).fill(-45)), 0);
  assert.equal(micMudo([-90, -90]), 0);
});

test('Source Record files a few seconds off the main recording still join the session', async () => {
  const { arquivosDaSessao, ehArquivoExtra } = await import('../src/sessao.js');
  const nomes = ['2026-11-19 21-00-00.mp4', '2026-11-19 21-00-02 camera.mp4', '2026-11-19 20-59-59 jogo.mp4', '2026-11-19 22-00-00.mp4'];
  const cfg = { nomesCamera: ['camera'], nomesJogo: ['jogo'] };
  const a = arquivosDaSessao('/in/2026-11-19 21-00-00.mp4', nomes, cfg);
  assert.equal(a.camera, '/in/2026-11-19 21-00-02 camera.mp4'); assert.equal(a.jogo, '/in/2026-11-19 20-59-59 jogo.mp4'); assert.equal(a.separados, true);
  assert.equal(ehArquivoExtra('2026-11-19 21-00-02 camera.mp4', nomes), true);
  assert.equal(ehArquivoExtra('2026-11-19 21-00-00.mp4', nomes), false);
  assert.equal(arquivosDaSessao('/in/2026-11-19 22-00-00.mp4', nomes, cfg).separados, false);
});

test('the YouTube daily limit is not a draft and does not use up a try', async () => {
  const { registrarResultadoYoutube } = await import('../src/youtubeChrome.js');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ytlim-'));
  const dir = path.join(base, 'fnando', '02-supino');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'post.json'), '{}');
  fs.writeFileSync(path.join(dir, '.youtube-chrome.json'), JSON.stringify({ tentativas: 1 }));
  const r = registrarResultadoYoutube(base, { id: 'fnando/02-supino', ok: false, etapa: 'esperar o envio terminar', erro: 'o YouTube mostrou: O limite diário de envios foi alcançado.' });
  assert.equal(r.estado.rascunho, false); assert.equal(r.estado.tentativas, 0);
  assert.ok(fs.existsSync(path.join(base, '.youtube-limite.json')));
  const d = registrarResultadoYoutube(base, { id: 'fnando/02-supino', ok: false, etapa: 'marcar Público', erro: 'não consegui marcar Público' });
  assert.equal(d.estado.rascunho, true);
});

test('a separate camera file is used whole: the scene corner (regiaoCamera) only applies to the scene', async () => {
  const { argsCorte } = await import('../src/corte.js');
  const reg = { x: 1440, y: 40, w: 440, h: 248 };
  const sep = argsCorte({ jogo: 'j.mp4', camera: 'c.mp4', audio: 'cena.mp4', start: 0, end: 10, ass: 'a.ass', out: 'o.mp4', formato: 'meio', regiaoCamera: reg }).join(' ');
  assert.ok(!sep.includes('crop=440:248:1440:40'));
  const cena = argsCorte({ jogo: 'cena.mp4', camera: 'cena.mp4', audio: 'cena.mp4', start: 0, end: 10, ass: 'a.ass', out: 'o.mp4', formato: 'meio', regiaoCamera: reg }).join(' ');
  assert.ok(cena.includes('crop=440:248:1440:40'));
});

test('a recording still open by OBS is not ready, even with a steady size', async (t) => {
  const { arquivoAberto } = await import('../src/observador.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'obs-')), 'rec.mp4');
  fs.writeFileSync(f, 'x');
  const fd = fs.openSync(f, 'a');
  const aberto = await arquivoAberto(f);
  fs.closeSync(fd);
  if (!aberto) return t.skip('lsof not available here');
  assert.equal(await arquivoAberto(f), false);
});

test('the music ducks under the voice track, not the whole mix', async () => {
  const { argsCorte } = await import('../src/corte.js');
  const base = { jogo: 'cena.mp4', camera: 'cena.mp4', audio: 'cena.mp4', start: 0, end: 10, ass: 'a.ass', out: 'o.mp4', formato: 'jogo', musica: { arquivo: 'm.mp3', volume: 0.22 } };
  const comVoz = argsCorte({ ...base, faixaVoz: 1, manter: [[0, 4], [5, 10]] }).join(' ');
  assert.ok(comVoz.includes('[0:a:1]aresample')); assert.ok(comVoz.includes('[mu][key]sidechaincompress')); assert.ok(comVoz.includes('[ksrc2]'));
  const semVoz = argsCorte(base).join(' ');
  assert.ok(semVoz.includes('[mu][a0s]sidechaincompress'));
});

test('webcam fixes: tighter frame up on the face and a light color fix', async () => {
  const { filtroCamera } = await import('../src/corte.js');
  assert.equal(filtroCamera({ camH: 960 }).includes('colorbalance'), false);
  const f = filtroCamera({ camH: 960, ajuste: { zoom: 1.25, subir: 0.8, brilho: 0.05, gama: 1.15, verde: -0.08 } });
  assert.ok(f.includes("crop='iw/1.25':'ih/1.25':'(iw-iw/1.25)/2':'(ih-ih/1.25)*0.20'"));
  assert.ok(f.includes('colorbalance=gm=-0.080')); assert.ok(f.includes('eq=brightness=0.050:gamma=1.150'));
});

test('restarts and stutters are cut from the speech', async () => {
  const { repeticoes, encolherSilencios } = await import('../src/corte.js');
  const fala = (txt, t0 = 0) => txt.split(' ').map((text, i) => ({ text, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.3 }));
  const w = fala('eu vou chamar o mecânico eu vou chamar o mecânico pra consertar o carro');
  assert.deepEqual(repeticoes(w), [[0, 1.96]]);
  assert.deepEqual(repeticoes(fala('vou cha vou chamar ele agora')), [[0, 0.76]]);
  assert.deepEqual(repeticoes(fala('não não faz isso cara')), []);
  assert.equal(repeticoes(fala('o o carro quebrou de novo')).length, 1);
  assert.equal(repeticoes(fala('ééé então bora lá galera')).length, 1);
  assert.deepEqual(repeticoes(fala('olha que carro bonito esse aqui')), []);
  const r = encolherSilencios(w, 6);
  assert.equal(r.palavras[0].text, 'eu'); assert.equal(r.palavras[5].text, 'pra');
  assert.ok(r.dur < 6 - 1.9);
  assert.equal(encolherSilencios(w, 6, { repeticoes: false }).dur, 6);
});

test('a scheduled cut can still be adjusted: held while redone, then the new video takes its slot', async () => {
  const base = sessao();
  const pronto = path.join(base, 'prontos', 'fnando', 's1_01-pia');
  fs.mkdirSync(pronto, { recursive: true });
  fs.writeFileSync(path.join(pronto, 'post.json'), JSON.stringify({ titulo: 'Pia', agendarPara: '2026-11-21T12:00:00Z' }));
  fs.writeFileSync(path.join(pronto, 'video.mp4'), 'velho');
  const f = path.join(base, 's1', 'sessao.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.cortes[0].status = 'entregue'; j.cortes[0].pastaEntrega = pronto; fs.writeFileSync(f, JSON.stringify(j));
  const c = pedirAjuste(base, { pasta: 's1', arquivo: '01-pia-meio.mp4', texto: 'legenda adiantada' });
  assert.equal(c.status, 'entregue');
  assert.equal(JSON.parse(fs.readFileSync(path.join(pronto, 'post.json'), 'utf8')).aviso, 'ajuste pedido por você');
  const render = async (job) => { fs.writeFileSync(job.out, 'novo'); return job.out; };
  const r = refazerCorte({ pastaSaida: base, linhas: [{ id: 'fnando' }] }, { pasta: 's1', arquivo: '01-pia-meio.mp4', edicao: {} }, { render, fazerCapa: async () => null, log: () => {} });
  await r.fila;
  assert.equal(fs.readFileSync(path.join(pronto, 'video.mp4'), 'utf8'), 'novo');
  const post = JSON.parse(fs.readFileSync(path.join(pronto, 'post.json'), 'utf8'));
  assert.equal(post.aviso, undefined); assert.equal(post.agendarPara, '2026-11-21T12:00:00Z');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).cortes[0].status, 'entregue');
});

test('jump cuts also trim a separate camera file, so the captions stay in sync', async () => {
  const { argsCorte } = await import('../src/corte.js');
  const a = argsCorte({ jogo: 'j.mp4', camera: 'c.mp4', audio: 'cena.mp4', start: 0, end: 10, ass: 'a.ass', out: 'o.mp4', formato: 'meio', manter: [[0, 3], [4, 10]] }).join(' ');
  assert.ok(a.includes('[1:v]split=2')); assert.ok(a.includes('concat=n=2:v=1:a=0[cm]')); assert.ok(a.includes('[cm]'));
});

test('a dead start cut off (one piece) is applied to picture and sound too', async () => {
  const { argsCorte } = await import('../src/corte.js');
  const a = argsCorte({ jogo: 'j.mp4', camera: 'c.mp4', audio: 'cena.mp4', start: 0, end: 27.8, ass: 'a.ass', out: 'o.mp4', formato: 'meio', manter: [[11.76, 27.8]] }).join(' ');
  assert.ok(a.includes('trim=start=11.76:end=27.8')); assert.ok(a.includes('[cm]'));
  const inteiro = argsCorte({ jogo: 'j.mp4', camera: 'c.mp4', audio: 'cena.mp4', start: 0, end: 10, ass: 'a.ass', out: 'o.mp4', formato: 'meio', manter: [[0, 10]] }).join(' ');
  assert.ok(!inteiro.includes('[cm]'));
});
