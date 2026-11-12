// Captions burned into the vertical cut: short lines, word-by-word karaoke highlight (ASS file for ffmpeg/libass).
// Adapted from the affiliate project's server/video.js (cuesOf/assOf), with the gameplay layout and the hook on top.

// Short caption lines (up to maxChars, broken after punctuation), each with its words for the karaoke highlight.
// words: [{ text, start, end }] in seconds, already relative to the cut.
export function cuesOf(words, { maxChars = 18 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    if (!w.text) continue;
    if (cur && (cur.text.length + 1 + w.text.length > maxChars || /[.!?;:,]$/.test(cur.words.at(-1).text))) { cues.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, text: w.text, words: [w] };
    else { cur.text += ` ${w.text}`; cur.end = w.end; cur.words.push(w); }
  }
  if (cur) cues.push(cur);
  // a line stays until the next starts when the gap is short, so the screen doesn't blink
  for (let i = 0; i < cues.length - 1; i++) if (cues[i + 1].start - cues[i].end < 0.6) cues[i].end = cues[i + 1].start;
  return cues;
}

export const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
// #RRGGBB → ASS &HAABBGGRR
export const assColor = (hex, alpha = 0) => `&H${alpha.toString(16).padStart(2, '0')}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();
const assText = (s) => String(s).replace(/[{}\\]/g, '').replace(/\n/g, '\\N').toUpperCase();

// Breaks a hook into at most two lines of about max characters.
export function wrap(text, max = 20) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines.at(-1);
    if (cur && (cur + ' ' + w).length > max && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = cur ? `${cur} ${w}` : w;
  }
  return lines.filter(Boolean).join('\n');
}

// The ASS file of one vertical cut.
// layout: { W, H, seam } (seam = y where the captions sit: the line between camera and game, or below the game)
// style: { font, primary (highlight), base (plain words), outline, modo: 'karaoke' | 'palavra' }
//   karaoke: a short line, each word turns yellow as it is spoken
//   palavra: one word at a time, big, with a pop; long words in yellow
// hook: text shown big at the top for hookSec seconds.
// marca: { arroba: '@fnando', arrobaPos: { x, y }, chamada: 'SEGUE', fimSec: 2, dur } — the handle stays small the whole
//   video; in the last fimSec seconds a big "SEGUE @fnando" card pops in the middle.
export function assOf(cues, { layout, style = {}, hook = '', hookSec = 2.5, marca = null } = {}) {
  const { W, H, seam } = layout;
  const font = style.font || 'Bricolage Grotesque';
  const hi = style.primary || '#FFE600', base = style.base || '#FFFFFF', ink = style.outline || '#000000';
  const modo = style.modo || 'karaoke';
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 5 = middle center, positioned with \pos on the seam
    `Style: Legenda,${font},84,${assColor(hi)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x60)},-1,0,0,0,100,100,0,0,1,8,3,5,60,60,0,1`,
    `Style: Palavra,${font},118,${assColor(base)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x50)},-1,0,0,0,100,100,0,0,1,10,4,5,60,60,0,1`,
    `Style: Gancho,${font},88,${assColor(base)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x40)},-1,0,0,0,100,100,0,0,3,14,0,8,60,60,${layout.ganchoY ?? 90},1`,
    `Style: Arroba,${font},40,${assColor(base, 0x30)},${assColor(base)},${assColor(ink, 0x40)},${assColor(ink, 0x80)},-1,0,0,0,100,100,0,0,1,3,0,6,30,30,0,1`,
    `Style: Fim,${font},96,${assColor(hi)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x30)},-1,0,0,0,100,100,0,0,3,18,0,5,60,60,0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  let lines;
  if (modo === 'palavra') {
    const ws = cues.flatMap((c) => c.words);
    lines = ws.map((w, i) => {
      const fim = i < ws.length - 1 ? Math.min(ws[i + 1].start, w.end + 0.6) : w.end + 0.4;
      const cor = String(w.text).replace(/[^\p{L}]/gu, '').length >= 6 ? `{\\c${assColor(hi)}}` : '';
      return `Dialogue: 1,${assTime(w.start)},${assTime(Math.max(fim, w.start + 0.12))},Palavra,,0,0,0,,{\\pos(${W / 2},${seam})\\fscx70\\fscy70\\t(0,90,\\fscx108\\fscy108)\\t(90,160,\\fscx100\\fscy100)}${cor}${assText(w.text)}`;
    });
  } else {
    lines = cues.map((c) => {
      let t = c.start;
      const body = c.words.map((w, i) => {
        const lead = Math.round((w.start - t) * 100);
        const dur = Math.max(1, Math.round((w.end - w.start) * 100));
        t = Math.max(t, w.start) + dur / 100;
        return `${lead > 0 ? `{\\k${lead}}` : ''}{\\kf${dur}}${assText(w.text)}${i < c.words.length - 1 ? ' ' : ''}`;
      }).join('');
      return `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Legenda,,0,0,0,,{\\pos(${W / 2},${seam})}${body}`;
    });
  }
  if (hook) lines.unshift(`Dialogue: 2,${assTime(0)},${assTime(hookSec)},Gancho,,0,0,0,,{\\fad(0,250)}${assText(wrap(hook))}`);
  if (marca?.arroba && marca.dur) {
    const fimSec = marca.fimSec ?? 2;
    const p = marca.arrobaPos || { x: W - 30, y: seam - 70 };
    const ate = Math.max(0, marca.dur - (marca.chamada === false ? 0 : fimSec));
    lines.push(`Dialogue: 3,${assTime(0)},${assTime(ate)},Arroba,,0,0,0,,{\\an6\\pos(${p.x},${p.y})}${String(marca.arroba).replace(/[{}\\]/g, '')}`);
    if (marca.chamada !== false) {
      const txt = `${assText(marca.chamada || 'SEGUE')}\\N${String(marca.arroba).replace(/[{}\\]/g, '')}`;
      lines.push(`Dialogue: 4,${assTime(Math.max(0, marca.dur - fimSec))},${assTime(marca.dur)},Fim,,0,0,0,,{\\pos(${W / 2},${Math.round(H / 2)})\\fscx60\\fscy60\\t(0,120,\\fscx106\\fscy106)\\t(120,200,\\fscx100\\fscy100)}${txt}`);
    }
  }
  return [...head, ...lines, ''].join('\n');
}
