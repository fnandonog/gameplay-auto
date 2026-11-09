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

// job: { jogo, camera (same file as jogo in scene mode), audio (the scene, default jogo), start, end, ass, out, regiaoCamera, camPct, zoom, fps, offsetCamera, encoder }
export function argsCorte(job) {
  const L = layoutDe(job.camPct);
  const dur = +(job.end - job.start).toFixed(3);
  const fps = job.fps || 60;
  const mesmo = job.camera === job.jogo;
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(job.start), '-t', String(dur), '-i', job.jogo];
  if (!mesmo) args.push('-ss', String(Math.max(0, job.start + (job.offsetCamera || 0))), '-t', String(dur), '-i', job.camera);
  // sound: the scene's track 1 (full mix); the Source Record files may have no audio
  const audio = job.audio || job.jogo;
  let n = mesmo ? 1 : 2;
  let audIn = '0:a:0';
  if (audio !== job.jogo && audio !== job.camera) { args.push('-ss', String(job.start), '-t', String(dur), '-i', audio); audIn = `${n}:a:0`; n++; }
  args.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=${job.corBarra || '0xFFE600'}:s=${W}x10:r=${fps}`);
  const camIn = mesmo ? '0:v' : '1:v';
  const barIn = `${n}:v`;
  const graph = [
    mesmo ? '[0:v]split=2[src_c][src_g]' : null,
    `[${mesmo ? 'src_c' : camIn}]${filtroCamera({ regiao: job.regiaoCamera, camH: L.camH })},fps=${fps}[cam]`,
    `[${mesmo ? 'src_g' : '0:v'}]${filtroJogo({ gameH: L.gameH, zoom: job.zoom })},fps=${fps}[game]`,
    '[cam][game]vstack=inputs=2[st]',
    `[st][${barIn}]overlay=x='-W+W*t/${dur}':y=H-10:eval=frame:shortest=1[pb]`,
    `[pb]ass='${fp(job.ass)}':fontsdir='${fp(FONTS)}',format=yuv420p[v]`,
    `[${audIn}]afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, dur - 0.3).toFixed(2)}:d=0.3,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
  ].filter(Boolean).join(';');
  args.push('-filter_complex', graph, '-map', '[v]', '-map', '[a]', ...encoderArgs(job.encoder), '-r', String(fps),
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

// Writes the ASS next to the output and renders. palavras: words relative to the cut start.
export async function renderCorte({ jogo, camera, audio, start, end, palavras = [], gancho = '', out, config = {} }) {
  const L = layoutDe(config.camPct);
  const ass = out.replace(/\.mp4$/, '.ass');
  fs.writeFileSync(ass, assOf(cuesOf(palavras), { layout: L, style: config.estilo, hook: gancho }));
  const args = argsCorte({ jogo, camera: camera || jogo, audio: audio || jogo, start, end, ass, out, regiaoCamera: config.regiaoCamera, camPct: config.camPct, zoom: config.zoomJogo, fps: config.fps, offsetCamera: config.offsetCamera, corBarra: config.corBarra, encoder: config.encoder || await melhorEncoder() });
  await run('ffmpeg', args, { timeoutMs: 30 * 60000 });
  return out;
}

// cover: one frame of the cut (default: 40% in, usually the reaction)
export async function capa(video, out, t) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60000 });
  return out;
}
