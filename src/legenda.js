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
// layout: { W, H, seam } (seam = y of the line between camera and game, where the captions sit)
// style: { font, primary (word already spoken), base (word still to come), outline }
// hook: text shown big at the top for hookSec seconds.
export function assOf(cues, { layout, style = {}, hook = '', hookSec = 2.5 } = {}) {
  const { W, H, seam } = layout;
  const font = style.font || 'Bricolage Grotesque';
  const hi = style.primary || '#FFE600', base = style.base || '#FFFFFF', ink = style.outline || '#000000';
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 5 = middle center, positioned with \pos on the seam
    `Style: Legenda,${font},84,${assColor(hi)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x60)},-1,0,0,0,100,100,0,0,1,8,3,5,60,60,0,1`,
    `Style: Gancho,${font},88,${assColor(base)},${assColor(base)},${assColor(ink)},${assColor(ink, 0x40)},-1,0,0,0,100,100,0,0,3,14,0,8,60,60,90,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = cues.map((c) => {
    let t = c.start;
    const body = c.words.map((w, i) => {
      const lead = Math.round((w.start - t) * 100);
      const dur = Math.max(1, Math.round((w.end - w.start) * 100));
      t = Math.max(t, w.start) + dur / 100;
      return `${lead > 0 ? `{\\k${lead}}` : ''}{\\kf${dur}}${assText(w.text)}${i < c.words.length - 1 ? ' ' : ''}`;
    }).join('');
    return `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Legenda,,0,0,0,,{\\pos(${W / 2},${seam})}${body}`;
  });
  if (hook) lines.unshift(`Dialogue: 2,${assTime(0)},${assTime(hookSec)},Gancho,,0,0,0,,{\\fad(0,250)}${assText(wrap(hook))}`);
  return [...head, ...lines, ''].join('\n');
}
