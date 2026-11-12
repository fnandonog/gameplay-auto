// The full YouTube video of a session (horizontal, the OBS scene with the camera in the corner):
// long stretches without speech shrink to a few seconds, the best moment plays first as a preview,
// then the channel intro, chapters come from the moments, and a thumbnail is drawn from the best frame with big words.
// Pure parts (segments, chapters, frame selection) are exported for the tests.
import fs from 'node:fs';
import path from 'node:path';
import { run, probe } from './run.js';
import { gerarIntro, juntar } from './intro.js';
import { encoderArgs, melhorEncoder, FONTS, fp } from './corte.js';
import { assColor, assTime, wrap } from './legenda.js';

// Parts to keep: everything except silences longer than silencioMax, which keep only `respiro` seconds at each edge.
// A silence inside a moment (protegidos) is never cut. Returns [{ start, end }] in session seconds.
export function segmentosLongos({ words, duracao, protegidos = [], silencioMax = 20, respiro = 2 }) {
  const fala = words.map((w) => [w.start, w.end]).sort((a, b) => a[0] - b[0]);
  // silences, minus the moments (a moment inside a silence splits it in two)
  const silencios = [];
  let ultimo = 0;
  for (const [s, e] of [...fala, [duracao, duracao]]) { if (s > ultimo) silencios.push([ultimo, s]); ultimo = Math.max(ultimo, e); }
  let livres = silencios;
  for (const p of protegidos) livres = livres.flatMap(([a, b]) => (p.end <= a || p.start >= b ? [[a, b]] : [[a, p.start], [p.end, b]].filter(([x, y]) => y > x)));
  const cortar = livres.filter(([a, b]) => b - a > silencioMax).map(([a, b]) => [a + respiro, b - respiro]).sort((x, y) => x[0] - y[0]);
  const out = [];
  let t = 0;
  for (const [a, b] of cortar) { if (a > t) out.push({ start: t, end: a }); t = b; }
  if (duracao > t) out.push({ start: t, end: duracao });
  return out.filter((s) => s.end - s.start > 0.5);
}

// session time → time in the edited video (after the preview of `previa` seconds); null if that moment was cut
export function mapearTempo(t, segs, previa = 0) {
  let acc = previa;
  for (const s of segs) {
    if (t >= s.start && t <= s.end) return acc + (t - s.start);
    acc += s.end - s.start;
  }
  return null;
}

const mmss = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}`; };

// YouTube chapters: first at 0:00, each at least 10 s long, at least 3 of them (or none)
export function capitulos(momentos, segs, previa) {
  const lista = [{ t: 0, nome: 'Melhor momento (prévia)' }, { t: previa, nome: 'Começo da partida' }];
  for (const m of [...momentos].sort((a, b) => a.start - b.start)) {
    const t = mapearTempo(m.start, segs, previa);
    if (t != null && t - lista.at(-1).t >= 10) lista.push({ t, nome: m.titulo || m.motivo });
  }
  if (previa < 10) lista.splice(1, 1);
  return lista.length >= 3 ? lista.map((c) => `${mmss(c.t)} ${String(c.nome).replace(/\s+/g, ' ').slice(0, 60)}`) : [];
}

// Exact cut of the kept parts in one decoding pass: select/aselect keep the frames inside the parts and setpts
// renumbers them. (The concat demuxer's inpoint starts at the keyframe before it, which added seconds of repeated
// footage with OBS's default keyframe interval.) Pure, for the tests.
export function filtrosSelecao(segs) {
  const e = segs.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+') || '0';
  return { vf: `select='${e}',setpts=N/FRAME_RATE/TB`, af: `aselect='${e}',asetpts=N/SR/TB` };
}

// thumbnail: best frame + 2-4 words, huge, yellow and white with a black outline (1280x720)
export function assThumb(texto, estilo = {}) {
  const hi = estilo.primary || '#FFE600', ink = estilo.outline || '#000000';
  return ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1280', 'PlayResY: 720', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: T,${estilo.font || 'Bricolage Grotesque'},150,${assColor(hi)},${assColor(hi)},${assColor(ink)},${assColor(ink, 0x40)},-1,0,0,0,100,100,0,0,1,12,6,1,50,50,40,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,${assTime(0)},${assTime(5)},T,,0,0,0,,${wrap(String(texto).toUpperCase(), 12).replace(/\n/g, '\\N')}`, ''].join('\n');
}

export async function renderLongo({ cena, words, duracao, momentos, pasta, config = {}, titulo, marca = null, log = console.log }) {
  const segs = segmentosLongos({ words, duracao, protegidos: momentos, silencioMax: config.silencioMax ?? 20 });
  const melhor = [...momentos].sort((a, b) => b.nota - a.nota)[0];
  const previa = melhor ? { start: Math.max(melhor.start, melhor.end - 10), end: melhor.end } : null;
  const durPrevia = previa ? previa.end - previa.start : 0;
  const out = path.join(pasta, 'youtube-completo.mp4');
  const usarIntro = config.intro?.noLongo !== false && !!previa;
  const intro = usarIntro ? await gerarIntro({ orientacao: 'horizontal', marca, config, log }).catch((e) => { log(`Sem intro: ${e.message}`); return null; }) : null;
  const durIntro = intro ? Number((await probe(intro).catch(() => ({}))).format?.duration) || 0 : 0;
  const total = durPrevia + durIntro + segs.reduce((n, s) => n + s.end - s.start, 0);
  log(`Vídeo longo: ${Math.round(duracao / 60)} min viram ${Math.round(total / 60)} min.`);
  const enc = config.encoder || await melhorEncoder();
  const fps = config.fps || 60;
  const saida = ['-map', '0:v:0', '-map', '0:a:0', ...encoderArgs(enc), '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart'];
  const video = 'scale=1920:1080:flags=lanczos,format=yuv420p,setsar=1';
  const audio = 'loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo';
  const partes = [];
  // preview, [intro], then the match: encoded apart with the same settings and joined by stream copy
  const p1 = path.join(pasta, '.previa.mp4'), p2 = path.join(pasta, '.corpo.mp4');
  try {
    if (previa) {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(previa.start), '-t', String(durPrevia), '-i', cena,
        '-vf', `fps=${fps},${video}`, '-af', audio, ...saida, p1], { timeoutMs: 30 * 60000 });
      partes.push(p1);
    }
    if (intro) partes.push(intro);
    const sel = filtrosSelecao(segs);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', cena, '-vf', `fps=${fps},${sel.vf},${video}`, '-af', `${sel.af},${audio}`, ...saida, p2], { timeoutMs: 6 * 3600000 });
    partes.push(p2);
    if (partes.length > 1) await juntar(partes, out); else fs.renameSync(p2, out);
  } finally { fs.rmSync(p1, { force: true }); fs.rmSync(p2, { force: true }); }

  // thumbnail
  const thumb = path.join(pasta, 'youtube-thumb.jpg');
  if (melhor) {
    const ass = path.join(pasta, 'thumb.ass');
    fs.writeFileSync(ass, assThumb(melhor.gancho || 'OLHA ISSO', config.estilo));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(melhor.end - 3), '-i', cena, '-frames:v', '1',
      '-vf', `scale=1280:720,eq=saturation=1.3:contrast=1.1,ass='${fp(ass)}':fontsdir='${fp(FONTS)}'`, '-q:v', '2', thumb], { timeoutMs: 120000 }).catch(() => null);
  }
  const caps = capitulos(momentos, segs, durPrevia + durIntro);
  const descricao = [melhor?.descricao, caps.length ? `Capítulos\n${caps.join('\n')}` : '', (melhor?.hashtags || []).map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
  return { arquivo: path.basename(out), thumb: fs.existsSync(thumb) ? path.basename(thumb) : null, titulo: titulo || melhor?.titulo || 'Gameplay completa', descricao, capitulos: caps, duracao: Math.round(total), status: 'aguardando' };
}
