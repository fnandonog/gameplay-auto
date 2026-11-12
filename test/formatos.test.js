import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { argsCorte, layoutFormato } from '../src/corte.js';
import { assOf, cuesOf } from '../src/legenda.js';
import { marcaDaLinha } from '../src/marca.js';
import { formatosDoCorte, formatoPrincipal } from '../src/sessao.js';
import { argsIntro, listaJuntar } from '../src/intro.js';
import { postDoCorte, entregarAprovados } from '../src/entrega.js';
import { editarCorte } from '../src/painel.js';
import { LINHAS_SUGERIDAS } from '../src/canais.js';

const job = { jogo: 'j.mp4', camera: 'c.mp4', audio: 'cena.mp4', start: 10, end: 40, ass: 'a.ass', out: 'o.mp4', encoder: 'libx264' };
const fc = (a) => a[a.indexOf('-filter_complex') + 1];

test('meio a meio: câmera e jogo com 960 px cada', () => {
  const L = layoutFormato('meio');
  assert.equal(L.camH, 960); assert.equal(L.gameH, 960); assert.equal(L.seam, 960);
  assert.match(fc(argsCorte({ ...job, formato: 'meio' })), /scale=1080:960.*vstack=inputs=2/s);
});

test('só o jogo: quadrado no meio sobre o jogo desfocado, sem ler a câmera', () => {
  const a = argsCorte({ ...job, formato: 'jogo' });
  assert.ok(!a.includes('c.mp4'));
  assert.match(fc(a), /boxblur/);
  assert.match(fc(a), /overlay=0:420/);
  assert.equal(layoutFormato('jogo').seam, 1650);
});

test('jogo em tela cheia preenche 1920 de altura', () => {
  assert.match(fc(argsCorte({ ...job, formato: 'jogocheio' })), /scale=-2:1920.*crop=1080:1920/);
});

test('logo da marca entra como imagem em loop e vai para o canto', () => {
  const a = argsCorte({ ...job, formato: 'meio', logo: 'logo.png', corBarra: '0x00E0FF' });
  assert.ok(a.includes('logo.png'));
  assert.ok(a.some((x) => x.includes('color=c=0x00E0FF')));
  assert.match(fc(a), /\[st\]\[lg\]overlay=30:840/);
});

test('legenda palavra a palavra: uma linha por palavra, palavra longa em amarelo', () => {
  const ws = [{ text: 'que', start: 0, end: 0.3 }, { text: 'golaço!', start: 0.4, end: 0.9 }];
  const ass = assOf(cuesOf(ws), { layout: layoutFormato('meio'), style: { modo: 'palavra' } });
  const d = ass.split('\n').filter((l) => l.startsWith('Dialogue'));
  assert.equal(d.length, 2);
  assert.ok(!d[0].includes('\\c&H'));
  assert.match(d[1], /\\c&H0000E6FF.*GOLAÇO!/);
});

test('@ do canal o vídeo todo e "SEGUE @" nos 2 segundos finais', () => {
  const ass = assOf([], { layout: layoutFormato('meio'), marca: { arroba: '@fnando', dur: 30, arrobaPos: { x: 1050, y: 910 } } });
  assert.match(ass, /Dialogue: 3,0:00:00.00,0:00:28.00,Arroba,.*\\pos\(1050,910\)}@fnando/);
  assert.match(ass, /Dialogue: 4,0:00:28.00,0:00:30.00,Fim,.*SEGUE\\N@fnando/);
});

test('marca vem da linha: CLIPAÍ ciano, FNANDO amarelo', () => {
  const clip = marcaDaLinha(LINHAS_SUGERIDAS.find((l) => l.id === 'clipai'));
  assert.equal(clip.arroba, '@clipai'); assert.equal(clip.corBarra, '0x00E0FF'); assert.match(clip.logo, /clipai-simbolo/);
  const f = marcaDaLinha({ id: 'principal' }, { marca: { arroba: 'fnando' } });
  assert.equal(f.arroba, '@fnando'); assert.equal(f.corBarra, '0xFFE600');
  assert.equal(marcaDaLinha({ id: 'x' }, { marca: { mostrarLogo: false } }).logo, null);
});

test('formato principal: meio quando tem fala, só o jogo quando é lance calado', () => {
  assert.deepEqual(formatosDoCorte({}), ['meio', 'jogo']);
  assert.deepEqual(formatosDoCorte({ formatos: ['xx', 'jogocheio'] }), ['jogocheio']);
  assert.equal(formatoPrincipal('auto', { palavras: 12 }), 'meio');
  assert.equal(formatoPrincipal('auto', { palavras: 2 }), 'jogo');
  assert.equal(formatoPrincipal('jogo', { palavras: 12 }), 'jogo');
  assert.equal(formatoPrincipal('auto', { palavras: 0, formatos: ['meio'] }), 'meio');
});

test('intro: 1080x1920 com a cor da marca e o whoosh; junta sem reencodar', () => {
  const a = argsIntro({ logo: 'w.png', cor: '#00E0FF', out: 'i.mp4' });
  assert.ok(a.some((x) => x.startsWith('color=c=0x0B0B0F:s=1080x1920')));
  assert.ok(a.some((x) => x.startsWith('color=c=0x00E0FF')));
  assert.ok(a.some((x) => x.startsWith('anoisesrc')));
  assert.ok(argsIntro({ logo: 'w.png', orientacao: 'horizontal', out: 'i.mp4' }).some((x) => x.includes('s=1920x1080')));
  assert.equal(listaJuntar(['/a/x.mp4', "/b/it's.mp4"]), "ffconcat version 1.0\nfile '/a/x.mp4'\nfile '/b/it'\\''s.mp4'\n");
});

test('post.json traz legenda de cada rede, linha, @ e formato', () => {
  const p = postDoCorte({ titulo: 'T', descricao: 'D?', hashtags: ['eafc26'], formato: 'meio', variantes: { meio: 'a', jogo: 'b' }, inicio: 1, fim: 31, nota: 9, arroba: '@fnando' },
    { sessao: 's1', linha: LINHAS_SUGERIDAS[0] });
  assert.equal(p.legendas.tiktok, 'T\n\nD?\n\n#eafc26');
  assert.equal(p.legendas.youtube.titulo, 'T #shorts');
  assert.deepEqual(p.outrosFormatos, ['jogo']);
  assert.equal(p.duracao, 30); assert.equal(p.linha.perfil, 'fnando'); assert.equal(p.arroba, '@fnando');
});

test('entrega copia os aprovados para a pasta da skill e troca de formato no painel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ent-'));
  const saida = path.join(dir, 'cortes'), prontos = path.join(dir, 'prontos');
  fs.mkdirSync(path.join(saida, 's1'), { recursive: true });
  for (const f of ['01-a-meio.mp4', '01-a-jogo.mp4', '02-b-meio.mp4']) fs.writeFileSync(path.join(saida, 's1', f), f);
  fs.writeFileSync(path.join(saida, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [
    { arquivo: '01-a-meio.mp4', formato: 'meio', variantes: { meio: '01-a-meio.mp4', jogo: '01-a-jogo.mp4' }, titulo: 'A', nota: 9, status: 'aguardando', linha: 'principal' },
    { arquivo: '02-b-meio.mp4', formato: 'meio', variantes: { meio: '02-b-meio.mp4' }, titulo: 'B', nota: 8, status: 'aguardando', linha: 'principal' },
  ] }));
  const c = editarCorte(saida, { pasta: 's1', arquivo: '01-a-meio.mp4', formato: 'jogo', status: 'aprovado' });
  assert.equal(c.arquivo, '01-a-jogo.mp4');
  assert.throws(() => editarCorte(saida, { pasta: 's1', arquivo: '02-b-meio.mp4', formato: 'jogo' }), /Formato inválido/);
  const config = { pastaSaida: saida, pastaEntrega: prontos, linhas: [{ ...LINHAS_SUGERIDAS[0] }] };
  assert.equal(entregarAprovados(config, { log: () => {} }), 1);
  const [pasta] = fs.readdirSync(path.join(prontos, 'principal'));
  const alvo = path.join(prontos, 'principal', pasta);
  assert.equal(fs.readFileSync(path.join(alvo, 'video.mp4'), 'utf8'), '01-a-jogo.mp4');
  assert.equal(JSON.parse(fs.readFileSync(path.join(alvo, 'post.json'), 'utf8')).formato, 'jogo');
  const s = JSON.parse(fs.readFileSync(path.join(saida, 's1', 'sessao.json'), 'utf8'));
  assert.deepEqual(s.cortes.map((x) => x.status), ['entregue', 'aguardando']);
  assert.equal(entregarAprovados(config, { log: () => {} }), 0);
});
