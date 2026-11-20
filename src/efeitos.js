// Edit effects of a cut, all pure (tested): profanity filter (masked caption + beep ranges), GTA-style pops
// (wanted stars on police talk, "$$$" on money talk) drawn as ASS vectors, and the background track choice.
// Nothing here uses official game art: the stars are a plain vector drawing and the text uses the channel font.
import fs from 'node:fs';
import path from 'node:path';
import { assTime, assColor } from './legenda.js';

export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// heavy: slurs, sexual and hateful words (always beeped). leve: common swearing (beeped only with nivel 'todos').
// An entry ending in * matches as a prefix; otherwise the whole word.
export const PALAVROES = {
  pesado: ['caralh*', 'foda*', 'fode*', 'fodi*', 'fudid*', 'fuder*', 'puta', 'putas', 'putinh*', 'putaria', 'buceta*', 'boceta*', 'xoxota*', 'piroca*', 'pica', 'cuzao', 'cuzinho', 'arrombad*', 'viado', 'viadinho', 'viados', 'veado', 'bichona', 'traveco*', 'vadia*', 'vagabund*', 'piranha', 'retardad*', 'mongol*', 'macaco', 'crioulo', 'boiola*', 'sapatao', 'escrot*', 'punheta*', 'filhodaputa', 'fdp', 'vsf', 'tnc', 'pqp'],
  leve: ['porra', 'puto', 'merda', 'bosta', 'cacete', 'cu', 'otario*', 'babaca', 'corno', 'desgracad*', 'idiota', 'imbecil'],
};

export function listaDoNivel(nivel = 'pesado', extras = []) {
  if (nivel === false || nivel === 'nenhum') return [];
  return [...PALAVROES.pesado, ...(nivel === 'todos' ? PALAVROES.leve : []), ...extras.map(normalizar)];
}

export function ehPalavrao(texto, lista) {
  const n = normalizar(texto);
  if (!n) return false;
  return lista.some((p) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p));
}

// "Caralho!" → "C******!" (keeps the first letter and the punctuation around it)
export function mascarar(texto) {
  const m = String(texto).match(/^(\W*)(\w)(\w*)(\W*)$/u);
  if (!m) return String(texto).replace(/\w/gu, '*');
  return `${m[1]}${m[2]}${'*'.repeat(Math.max(2, m[3].length))}${m[4]}`;
}

// palavras: [{ text, start, end }] on the final timeline. Also catches "filho da puta" spread over words (the last
// word is enough, it is on the list). Returns the masked words and the ranges to beep, merged when close.
export function filtrarPalavroes(palavras = [], { nivel = 'pesado', extras = [], folga = 0.04 } = {}) {
  const lista = listaDoNivel(nivel, extras);
  const bips = [];
  const out = palavras.map((w) => {
    if (!lista.length || !ehPalavrao(w.text, lista)) return w;
    bips.push([Math.max(0, +(w.start - folga).toFixed(2)), +(w.end + folga).toFixed(2)]);
    return { ...w, text: mascarar(w.text), palavrao: true };
  });
  const juntos = [];
  for (const b of bips) {
    const u = juntos.at(-1);
    if (u && b[0] - u[1] < 0.15) u[1] = Math.max(u[1], b[1]);
    else juntos.push([...b]);
  }
  return { palavras: out, bips: juntos };
}

// words that fire a pop. Police → wanted stars; money → "$$$".
const GATILHOS = {
  procurado: ['policia*', 'policial*', 'procurad*', 'viatura*', 'sirene*', 'algema*', 'preso', 'presa', 'prende*', 'prisao', 'cadeia', 'xadrez', 'perseguica*', 'fug*', 'estrela*', 'swat', 'helicoptero*', 'cana'],
  grana: ['dinheir*', 'grana', 'dolar*', 'milhao', 'milhoes', 'milionari*', 'rico', 'rica', 'ricos', 'paga*', 'pagou', 'compr*', 'caro', 'assalt*', 'roub*', 'banco', 'cofre', 'joia*', 'lucr*'],
};

// at most one pop each `intervalo` seconds and `max` per cut; never in the first second (hook) or the end card
export function adesivosDe(palavras = [], dur = Infinity, { intervalo = 6, max = 4, fimSec = 2 } = {}) {
  const out = [];
  let ultimo = -Infinity;
  for (const w of palavras) {
    if (w.palavrao || w.start < 1 || w.start > dur - fimSec - 1.2) continue;
    const n = normalizar(w.text);
    const tipo = Object.keys(GATILHOS).find((k) => GATILHOS[k].some((p) => (p.endsWith('*') ? n.startsWith(p.slice(0, -1)) : n === p)));
    if (!tipo || w.start - ultimo < intervalo) continue;
    out.push({ tipo, t: +w.start.toFixed(2) });
    ultimo = w.start;
    if (out.length >= max) break;
  }
  return out;
}

// 5-point star as an ASS vector path (\p1), size s, origin at the top-left of its box
export function estrelaPath(s = 64) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.2 : s * 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.round(s / 2 + r * Math.cos(a)), Math.round(s / 2 + r * Math.sin(a))]);
  }
  return `m ${pts[0][0]} ${pts[0][1]} l ${pts.slice(1).map((p) => p.join(' ')).join(' ')}`;
}

// ASS Dialogue lines for the pops, just above the caption line (layout.seam), with a pop-in and a fade-out.
export function assAdesivos(adesivos = [], layout, { seg = 2.2, cor = '#FFE600' } = {}) {
  const { W, seam } = layout;
  const y = Math.max(140, seam - 82); // the band between the picture and the caption line
  const lines = [];
  for (const a of adesivos) {
    const ini = assTime(a.t), fim = assTime(a.t + seg);
    if (a.tipo === 'procurado') {
      const s = 76, gap = 12, n = 5;
      const x0 = Math.round(W / 2 - (n * s + (n - 1) * gap) / 2);
      for (let i = 0; i < n; i++) {
        const d = i * 90; // stars light up one after the other
        lines.push(`Dialogue: 5,${ini},${fim},Legenda,,0,0,0,,{\\an7\\pos(${x0 + i * (s + gap)},${y - s / 2})\\bord5\\shad3\\1c${assColor(i < 4 ? cor : '#FFFFFF')}\\3c&H000000&\\alpha&HFF&\\t(${d},${d + 1},\\alpha&H00&)\\fscx40\\fscy40\\t(${d},${d + 140},\\fscx115\\fscy115)\\t(${d + 140},${d + 220},\\fscx100\\fscy100)\\fad(0,250)\\p1}${estrelaPath(s)}{\\p0}`);
      }
    } else if (a.tipo === 'grana') {
      lines.push(`Dialogue: 5,${ini},${fim},Palavra,,0,0,0,,{\\pos(${W / 2},${y})\\1c&H3DD15C&\\bord10\\frz-6\\fscx40\\fscy40\\t(0,130,\\fscx125\\fscy125\\frz4)\\t(130,240,\\fscx110\\fscy110\\frz-3)\\fad(0,250)}$$$`);
    }
  }
  return lines;
}

// background track for a cut: a royalty-free file from the music folder, picked by the cut's name so a series
// does not repeat the same song back to back. null when the folder is empty or music is off.
export function escolherMusica(nome, musica = {}, listar = (d) => { try { return fs.readdirSync(d); } catch { return []; } }) {
  if (!musica || musica.ligado === false || !musica.pasta) return null;
  const arqs = listar(musica.pasta).filter((f) => /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(f)).sort();
  if (!arqs.length) return null;
  let h = 0;
  for (const c of String(nome)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return path.join(musica.pasta, arqs[h % arqs.length]);
}

// reaction words: a quick punch-in zoom, a deep "boom" and the word bigger in red on the caption (the style of the big
// BR gameplay channels: the reaction is the moment, so the edit hits it)
// only strong reactions (subtle and rare: at most 2 per cut, 8 s apart)
const REACOES = ['caraca', 'caramba', 'meudeus', 'socorro', 'bizarro', 'bizarra', 'insano', 'insana', 'absurdo', 'absurda', 'surreal', 'queisso', 'doideira', 'sinistro', 'sinistra'];
export function impactosDe(palavras = [], dur = Infinity, { intervalo = 8, max = 2, fimSec = 2 } = {}) {
  const out = [];
  let ultimo = -Infinity;
  for (let i = 0; i < palavras.length; i++) {
    const w = palavras[i];
    if (w.palavrao || w.start < 0.8 || w.start > dur - fimSec - 0.6) continue;
    const n = normalizar(w.text), dois = n + normalizar(palavras[i + 1]?.text);
    const hit = REACOES.includes(dois) ? 2 : REACOES.includes(n) ? 1 : 0;
    if (!hit || w.start - ultimo < intervalo) continue;
    out.push({ t: +w.start.toFixed(2), i, n: hit });
    ultimo = w.start;
    if (out.length >= max) break;
  }
  return out;
}
// pure: marks the reaction words for the caption (enfase)
export function marcarEnfase(palavras, impactos) {
  const idx = new Set(impactos.flatMap((m) => (m.n === 2 ? [m.i, m.i + 1] : [m.i])));
  return palavras.map((w, i) => (idx.has(i) ? { ...w, enfase: true } : w));
}
// pure: zoompan expression of the punch-ins (a gentle 6 % push over 0.7 s around each hit), frame based
export function zoomDosImpactos(ts = [], fps = 60, forca = 0.06) {
  if (!ts.length) return null;
  const pulso = ts.map((t) => `max(0,1-abs(in/${fps}-${(t + 0.1).toFixed(2)})/0.35)`).join('+');
  return `1+${forca}*min(1,${pulso})`;
}
