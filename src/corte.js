// Renders one vertical cut (1080x1920): the camera on top, the game below, captions on the line between them, the hook
// for the first seconds and a thin progress bar at the bottom. Pure parts (layout, ffmpeg arguments) are exported for
// the tests; renderCorte runs ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';
import { assOf, cuesOf } from './legenda.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS = path.join(ROOT, 'fonts');
export const W = 1080, H = 1920;

// camPct: share of the height for the camera (0.4 = camera 768 px, game 1152 px)
export function layoutDe(camPct = 0.4) {
  const camH = Math.round((H * camPct) / 2) * 2;
  return { W, H, camH, gameH: H - camH, seam: camH };
}

// path inside a filter graph: escape what libavfilter reads specially
export const fp = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');

// crop of the camera: region {x,y,w,h} of the source (scene mode) then a centered crop to the box's aspect
export function filtroCamera({ regiao, camH }) {
  const pre = regiao ? `crop=${regiao.w}:${regiao.h}:${regiao.x}:${regiao.y},` : '';
  const ar = `${W}/${camH}`;
  return `${pre}crop='min(iw,ih*${ar})':'min(ih,iw/(${ar}))',scale=${W}:${camH}:flags=lanczos,setsar=1`;
}

// the game fills its box by height and is cropped in the center (zoom: >1 tighter on the action)
export function filtroJogo({ gameH, zoom = 1 }) {
  const h = Math.round((gameH * zoom) / 2) * 2;
  return `scale=-2:${h}:flags=lanczos,crop=${W}:${gameH},setsar=1`;
}

// The vertical formats. Each one says where the captions, the hook and the handle go.
//   meio       camera on top half, game on the bottom half (meio a meio)
//   camtopo    camera 40% on top, game 60% (more game)
//   jogo       only the game: a big square of the action in the middle over the same game blurred
//   jogocheio  only the game, filling the whole screen (the sides are cut)
export const FORMATOS = {
  meio: { nome: 'Meio a meio', camPct: 0.5 },
  camtopo: { nome: 'Câmera em cima', camPct: 0.4 },
  jogo: { nome: 'Só o jogo', semCamera: true },
  jogocheio: { nome: 'Jogo em tela cheia', semCamera: true },
};

// layout of a format: where each thing sits (pure)
export function layoutFormato(formato = 'camtopo', { camPct } = {}) {
  const f = FORMATOS[formato] ? formato : 'camtopo';
  if (f === 'jogo') {
    const lado = W, top = Math.round((H - lado) / 2); // 420..1500
    return { formato: f, W, H, quadro: { y: top, lado }, seam: top + lado + 150, ganchoY: 150, arrobaPos: { x: W - 30, y: top + lado + 40 }, logoPos: { x: 30, y: top + lado + 14 } };
  }
  if (f === 'jogocheio') return { formato: f, W, H, seam: 1380, ganchoY: 200, arrobaPos: { x: W - 30, y: 1500 }, logoPos: { x: 30, y: 1470 } };
  const L = layoutDe(camPct ?? FORMATOS[f].camPct);
  return { ...L, formato: f, ganchoY: 90, arrobaPos: { x: W - 30, y: L.camH - 50 }, logoPos: { x: 30, y: L.camH - 120 } };
}

// job: { jogo, camera (same file as jogo in scene mode), audio (the scene, default jogo), start, end, ass, out, formato,
//        regiaoCamera, camPct, zoom, fps, offsetCamera, encoder, logo (png, optional), logoTam }
export function argsCorte(job) {
  const formato = FORMATOS[job.formato] ? job.formato : (job.camPct ? 'camtopo' : 'camtopo');
  const L = layoutFormato(formato, { camPct: job.camPct });
  const semCam = !!FORMATOS[formato].semCamera;
  const dur = +(job.end - job.start).toFixed(3);
  const fps = job.fps || 60;
  const mesmo = semCam || job.camera === job.jogo;
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(job.start), '-t', String(dur), '-i', job.jogo];
  if (!mesmo) args.push('-ss', String(Math.max(0, job.start + (job.offsetCamera || 0))), '-t', String(dur), '-i', job.camera);
  // sound: the scene's track 1 (full mix); the Source Record files may have no audio
  const audio = job.audio || job.jogo;
  let n = mesmo ? 1 : 2;
  let audIn = '0:a:0';
  if (audio !== job.jogo && (semCam || audio !== job.camera)) { args.push('-ss', String(job.start), '-t', String(dur), '-i', audio); audIn = `${n}:a:0`; n++; }
  args.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=${job.corBarra || '0xFFE600'}:s=${W}x10:r=${fps}`);
  const barIn = `${n}:v`; n++;
  let logoIn = null;
  if (job.logo) { args.push('-loop', '1', '-t', String(dur), '-i', job.logo); logoIn = `${n}:v`; n++; }
  const camIn = mesmo ? '0:v' : '1:v';
  const g = [];
  if (formato === 'jogo') {
    const q = L.quadro;
    g.push('[0:v]split=2[gb][gf]',
      `[gb]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bilinear,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12:saturation=1.2,setsar=1,fps=${fps}[bg]`,
      `[gf]${filtroJogo({ gameH: q.lado, zoom: job.zoom })},fps=${fps}[fg]`,
      `[bg][fg]overlay=0:${q.y}[st]`);
  } else if (formato === 'jogocheio') {
    g.push(`[0:v]${filtroJogo({ gameH: H, zoom: job.zoom })},fps=${fps}[st]`);
  } else {
    if (job.camera === job.jogo) g.push('[0:v]split=2[src_c][src_g]');
    g.push(`[${job.camera === job.jogo ? 'src_c' : camIn}]${filtroCamera({ regiao: job.regiaoCamera, camH: L.camH })},fps=${fps}[cam]`,
      `[${job.camera === job.jogo ? 'src_g' : '0:v'}]${filtroJogo({ gameH: L.gameH, zoom: job.zoom })},fps=${fps}[game]`,
      '[cam][game]vstack=inputs=2[st]');
  }
  let ultimo = 'st';
  if (logoIn) {
    const tam = job.logoTam || 96;
    g.push(`[${logoIn}]scale=${tam}:-1,format=rgba,colorchannelmixer=aa=0.92[lg]`, `[st][lg]overlay=${L.logoPos.x}:${L.logoPos.y}:shortest=1[sl]`);
    ultimo = 'sl';
  }
  g.push(`[${ultimo}][${barIn}]overlay=x='-W+W*t/${dur}':y=H-10:eval=frame:shortest=1[pb]`,
    `[pb]ass='${fp(job.ass)}':fontsdir='${fp(FONTS)}',format=yuv420p[v]`,
    `[${audIn}]afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, dur - 0.3).toFixed(2)}:d=0.3,loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[a]`);
  args.push('-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]', ...encoderArgs(job.encoder), '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', job.out);
  return args;
}

export function encoderArgs(enc = 'libx264') {
  if (enc === 'h264_videotoolbox') return ['-c:v', 'h264_videotoolbox', '-b:v', '14M', '-maxrate', '18M', '-profile:v', 'high', '-allow_sw', '1'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high'];
}

let _enc;
export async function melhorEncoder() {
  if (_enc) return _enc;
  const out = await run('ffmpeg', ['-hide_banner', '-encoders'], { timeoutMs: 10000 }).catch(() => '');
  _enc = /h264_videotoolbox/.test(out) && process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264';
  return _enc;
}

// Writes the ASS next to the output and renders one format.
// marca: { arroba, chamada, logo } of the cut's channel line (see marcaDaLinha in src/marca.js)
export async function renderCorte({ jogo, camera, audio, start, end, palavras = [], gancho = '', out, formato, marca = null, config = {} }) {
  const fmt = formato || config.formatoPadrao || 'camtopo';
  const L = layoutFormato(FORMATOS[fmt] ? fmt : 'camtopo', { camPct: fmt === 'camtopo' ? config.camPct : undefined });
  const ass = out.replace(/\.mp4$/, '.ass');
  const dur = end - start;
  fs.writeFileSync(ass, assOf(cuesOf(palavras), { layout: L, style: config.estilo, hook: gancho, marca: marca?.arroba ? { ...marca, dur, arrobaPos: L.arrobaPos } : null }));
  const logo = marca?.logo && fs.existsSync(marca.logo) ? marca.logo : null;
  const args = argsCorte({ jogo, camera: camera || jogo, audio: audio || jogo, start, end, ass, out, formato: L.formato, regiaoCamera: config.regiaoCamera, camPct: fmt === 'camtopo' ? config.camPct : undefined, zoom: config.zoomJogo, fps: config.fps, offsetCamera: config.offsetCamera, corBarra: marca?.corBarra || config.corBarra, logo, encoder: config.encoder || await melhorEncoder() });
  await run('ffmpeg', args, { timeoutMs: 30 * 60000 });
  return out;
}

// cover: one frame of the cut (default: 40% in, usually the reaction)
export async function capa(video, out, t) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60000 });
  return out;
}
