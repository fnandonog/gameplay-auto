// Renders one vertical cut (1080x1920): the camera on top, the game below, captions on the line between them, the hook
// for the first seconds and a thin progress bar at the bottom. Pure parts (layout, ffmpeg arguments) are exported for
// the tests; renderCorte runs ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';
import { assOf, cuesOf } from './legenda.js';
import { filtrarPalavroes, adesivosDe, assAdesivos, escolherMusica, impactosDe, marcarEnfase, zoomDosImpactos } from './efeitos.js';

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

// Automatic framing for the game-only formats: when the player talks about the minimap the cut jumps to it, and on a
// reaction word ("bizarro", "olha", "caraca"...) the game punches in for a moment. Pure: words (relative to the cut) →
// pieces covering [0, dur], each { de, ate, tipo: 'normal' | 'zoom' | 'regiao', regiao? }.
export const PALAVRAS_MINIMAPA = /^(minimapa|mapinha|radar|gps|minimap)$/i;
export const FRASES_MINIMAPA = /\b(no|o|do|pelo) (mini ?)?mapa\b|\bcanto do mapa\b|\bali embaixo\b/i;
export const PALAVRAS_REACAO = /^(bizarro|bizarra|caraca|caralho|nossa|olha|insano|genial|doideira|louca|louco|absurdo|incrível|incrivel|sensacional)$/i;
// GTA 6's minimap on a 1920x1080 capture (bottom left)
export const MINIMAPA_GTA = { x: 20, y: 830, w: 340, h: 230 };

export function focosDe(palavras = [], dur, { minimapa = MINIMAPA_GTA, zoom = 1.25, zoomSeg = 0.9, intervalo = 3, minimapaSeg = 3.2, reacoes = true } = {}) {
  const limpa = (w) => String(w.text || '').toLowerCase().replace(/[^\p{L}]/gu, '');
  const marcas = [];
  if (minimapa) {
    for (let i = 0; i < palavras.length; i++) {
      const w = palavras[i], dupla = `${limpa(palavras[i - 1] || {})} ${limpa(w)}`;
      if (PALAVRAS_MINIMAPA.test(limpa(w)) || FRASES_MINIMAPA.test(dupla) || FRASES_MINIMAPA.test(`${dupla} ${limpa(palavras[i + 1] || {})}`)) {
        marcas.push({ de: Math.max(0, w.start - 0.2), ate: Math.min(dur, w.start + minimapaSeg), tipo: 'regiao', regiao: minimapa });
      }
    }
  }
  if (reacoes) {
    let ultimo = -Infinity;
    for (const w of palavras) {
      if (!PALAVRAS_REACAO.test(limpa(w)) || w.start - ultimo < intervalo || w.start < 0.5) continue;
      if (marcas.some((m) => w.start < m.ate + 0.3 && w.start + zoomSeg > m.de - 0.3)) continue;
      marcas.push({ de: w.start, ate: Math.min(dur, w.start + zoomSeg), tipo: 'zoom', zoom });
      ultimo = w.start;
    }
  }
  // merge overlaps (the first wins), then fill the gaps with normal framing
  marcas.sort((a, b) => a.de - b.de);
  const out = []; let t = 0;
  for (const m of marcas) {
    if (m.ate - Math.max(m.de, t) < 0.4) continue;
    const de = Math.max(m.de, t);
    if (de - t > 0.04) out.push({ de: +t.toFixed(2), ate: +de.toFixed(2), tipo: 'normal' });
    out.push({ ...m, de: +de.toFixed(2), ate: +m.ate.toFixed(2) });
    t = m.ate;
  }
  if (dur - t > 0.04) out.push({ de: +t.toFixed(2), ate: +dur.toFixed(2), tipo: 'normal' });
  return out.length ? out : [{ de: 0, ate: dur, tipo: 'normal' }];
}

// Jump cuts: a pause in the speech longer than maxGap shrinks to `fica` seconds, so the cut never sits still.
// Only when the cut has speech (minPalavras); a quiet play is left whole. Pure: words relative to the cut →
// { manter: [[a, b], ...] in the cut's time, palavras: remapped to the new time, dur: new length }.
export function encolherSilencios(palavras = [], dur, { maxGap = 1.6, fica = 0.45, minPalavras = 5, inicioMax = 1.2 } = {}) {
  const ws = palavras.filter((w) => w.end > 0 && w.start < dur);
  if (ws.length < minPalavras) return { manter: [[0, dur]], palavras, dur };
  const cortes = []; // [from, to] removed
  let fim = 0;
  // dead start before the first word
  if (ws[0].start > inicioMax) cortes.push([0, ws[0].start - fica]);
  fim = ws[0].end;
  for (const w of ws.slice(1)) {
    if (w.start - fim > maxGap) cortes.push([fim + fica / 2, w.start - fica / 2]);
    fim = Math.max(fim, w.end);
  }
  if (!cortes.length) return { manter: [[0, dur]], palavras, dur };
  const manter = []; let t = 0;
  for (const [a, b] of cortes) { if (a > t) manter.push([+t.toFixed(2), +a.toFixed(2)]); t = b; }
  if (dur > t) manter.push([+t.toFixed(2), +dur.toFixed(2)]);
  const mapa = (x) => { let tirado = 0; for (const [a, b] of cortes) { if (x >= b) tirado += b - a; else if (x > a) return +(a - tirado).toFixed(2); } return +(x - tirado).toFixed(2); };
  const novo = manter.reduce((n, [a, b]) => n + b - a, 0);
  return { manter, palavras: palavras.map((w) => ({ ...w, start: mapa(w.start), end: mapa(w.end) })), dur: +novo.toFixed(2) };
}

// crop of one framing piece, for a box of aspect ar (w/h), inside a 1920x1080 source (pure)
export function cropFoco(f, ar, src = { w: 1920, h: 1080 }) {
  if (f.tipo === 'zoom') return `crop=iw/${f.zoom || 1.25}:ih/${f.zoom || 1.25}:(iw-ow)/2+${f.tremor ?? 10}*sin(47*t):(ih-oh)/2+${f.tremor ?? 10}*cos(41*t),`;
  if (f.tipo !== 'regiao' || !f.regiao) return '';
  const r = f.regiao, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = Math.max(r.w, r.h * ar) * 1.12, h = w / ar;
  if (h > src.h) { h = src.h; w = h * ar; }
  const x = Math.round(Math.min(Math.max(0, cx - w / 2), src.w - w) / 2) * 2, y = Math.round(Math.min(Math.max(0, cy - h / 2), src.h - h) / 2) * 2;
  return `crop=${Math.round(w / 2) * 2}:${Math.round(h / 2) * 2}:${x}:${y},`;
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
  const durFonte = +(job.end - job.start).toFixed(3);
  const fps = job.fps || 60;
  const mesmo = semCam || job.camera === job.jogo;
  // jump cuts (encolherSilencios): only when the picture comes from one file
  const manter = mesmo && Array.isArray(job.manter) && job.manter.length > 1 ? job.manter : null;
  const dur = manter ? +manter.reduce((n, [a, b]) => n + b - a, 0).toFixed(3) : durFonte;
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(job.start), '-t', String(durFonte), '-i', job.jogo];
  if (!mesmo) args.push('-ss', String(Math.max(0, job.start + (job.offsetCamera || 0))), '-t', String(durFonte), '-i', job.camera);
  // sound: the scene's track 1 (full mix); the Source Record files may have no audio
  const audio = job.audio || job.jogo;
  let n = mesmo ? 1 : 2;
  let audIn = '0:a:0';
  if (audio !== job.jogo && (semCam || audio !== job.camera)) { args.push('-ss', String(job.start), '-t', String(durFonte), '-i', audio); audIn = `${n}:a:0`; n++; }
  args.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=${job.corBarra || '0xFFE600'}:s=${W}x10:r=${fps}`);
  const barIn = `${n}:v`; n++;
  let logoIn = null;
  if (job.logo) { args.push('-loop', '1', '-t', String(dur), '-i', job.logo); logoIn = `${n}:v`; n++; }
  // whoosh on each framing jump (job.sons: seconds in the final cut)
  const sons = (job.sons || []).filter((t) => t >= 0 && t < dur).slice(0, 12);
  let sfxIn = null;
  if (sons.length) { args.push('-f', 'lavfi', '-t', '0.45', '-i', 'anoisesrc=d=0.45:c=pink:a=0.6:r=48000'); sfxIn = `${n}:a`; n++; }
  // profanity beep (job.bips: [a, b] in the final cut) and background music (job.musica: { arquivo, volume })
  const bips = (job.bips || []).filter(([a, b]) => b > a && a < dur).slice(0, 40);
  const entre = bips.map(([a, b]) => `between(t,${a},${b})`).join('+');
  let bipIn = null, musIn = null;
  if (bips.length) { args.push('-f', 'lavfi', '-t', String(dur), '-i', 'sine=frequency=1000:sample_rate=48000'); bipIn = `${n}:a`; n++; }
  // reaction hits (job.impactos: seconds in the final cut): punch-in zoom + a deep boom
  const impactos = (job.impactos || []).filter((t) => t >= 0 && t < dur).slice(0, 8);
  let boomIn = null;
  if (impactos.length) { args.push('-f', 'lavfi', '-t', '0.7', '-i', "aevalsrc='0.8*sin(2*PI*(48+90*exp(-9*t))*t)*exp(-4.5*t)':s=48000:d=0.7"); boomIn = `${n}:a`; n++; }
  if (job.musica?.arquivo) { args.push('-stream_loop', '-1', '-t', String(dur), '-i', job.musica.arquivo); musIn = `${n}:a:0`; n++; }
  const g = [];
  let vIn = '0:v';
  if (manter) {
    const k = manter.length;
    g.push(`[0:v]split=${k}${manter.map((_, i) => `[mv${i}]`).join('')}`, `[${audIn}]asplit=${k}${manter.map((_, i) => `[ma${i}]`).join('')}`);
    manter.forEach(([a, b], i) => g.push(`[mv${i}]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[mw${i}]`, `[ma${i}]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[mb${i}]`));
    g.push(`${manter.map((_, i) => `[mw${i}][mb${i}]`).join('')}concat=n=${k}:v=1:a=1[vm][am]`);
    vIn = 'vm'; audIn = 'am';
  }
  const camIn = mesmo ? vIn : '1:v';
  // game-only formats: each framing piece (job.focos, see focosDe) is cropped on its own and the pieces are joined
  const focos = semCam && Array.isArray(job.focos) && job.focos.some((f) => f.tipo !== 'normal') ? job.focos : null;
  const jogoEnquadrado = (entrada, gameH, saida) => {
    if (!focos) { g.push(`[${entrada}]${filtroJogo({ gameH, zoom: job.zoom })},fps=${fps}[${saida}]`); return; }
    const ar = W / gameH;
    g.push(`[${entrada}]split=${focos.length}${focos.map((_, i) => `[p${i}]`).join('')}`);
    focos.forEach((f, i) => g.push(`[p${i}]trim=start=${f.de}:end=${f.ate},setpts=PTS-STARTPTS,${cropFoco(f, ar, job.fonte)}${filtroJogo({ gameH, zoom: f.tipo === 'normal' ? job.zoom : 1 })},fps=${fps}[q${i}]`));
    g.push(`${focos.map((_, i) => `[q${i}]`).join('')}concat=n=${focos.length}:v=1:a=0[${saida}]`);
  };
  if (formato === 'jogo') {
    const q = L.quadro;
    g.push(`[${vIn}]split=2[gb][gf]`,
      `[gb]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bilinear,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12:saturation=1.2,setsar=1,fps=${fps}[bg]`);
    jogoEnquadrado('gf', q.lado, 'fg');
    g.push(`[bg][fg]overlay=0:${q.y}[st]`);
  } else if (formato === 'jogocheio') {
    jogoEnquadrado(vIn, H, 'st');
  } else {
    if (job.camera === job.jogo) g.push(`[${vIn}]split=2[src_c][src_g]`);
    g.push(`[${job.camera === job.jogo ? 'src_c' : camIn}]${filtroCamera({ regiao: job.regiaoCamera, camH: L.camH })},fps=${fps}[cam]`,
      `[${job.camera === job.jogo ? 'src_g' : vIn}]${filtroJogo({ gameH: L.gameH, zoom: job.zoom })},fps=${fps}[game]`,
      '[cam][game]vstack=inputs=2[st]');
  }
  let ultimo = 'st';
  const z = zoomDosImpactos(impactos, fps);
  if (z) { g.push(`[st]zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}[stz]`); ultimo = 'stz'; }
  if (logoIn) {
    const tam = job.logoTam || 96;
    g.push(`[${logoIn}]scale=${tam}:-1,format=rgba,colorchannelmixer=aa=0.92[lg]`, `[${ultimo}][lg]overlay=${L.logoPos.x}:${L.logoPos.y}:shortest=1[sl]`);
    ultimo = 'sl';
  }
  g.push(`[${ultimo}][${barIn}]overlay=x='-W+W*t/${dur}':y=H-10:eval=frame:shortest=1[pb]`,
    `[pb]ass='${fp(job.ass)}':fontsdir='${fp(FONTS)}',format=yuv420p[v]`,
    `[${audIn}]${entre ? `volume='if(${entre},0,1)':eval=frame,` : ''}afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, dur - 0.3).toFixed(2)}:d=0.3,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB,aformat=sample_rates=48000:channel_layouts=stereo[a0]`);
  const mix = ['a0'];
  if (musIn) {
    // the music ducks under the voice (sidechain) and fades in and out
    g.push('[a0]asplit=2[a0v][a0s]', `[${musIn}]aformat=sample_rates=48000:channel_layouts=stereo,volume=${job.musica.volume ?? 0.12},afade=t=in:d=1,afade=t=out:st=${Math.max(0, dur - 1.5).toFixed(2)}:d=1.5[mu]`,
      '[mu][a0s]sidechaincompress=threshold=0.015:ratio=12:attack=15:release=450:makeup=1[md]');
    mix[0] = 'a0v'; mix.push('md');
  }
  if (boomIn) {
    g.push(`[${boomIn}]lowpass=f=180,volume=0.9,aformat=sample_rates=48000:channel_layouts=stereo,asplit=${impactos.length}${impactos.map((_, i) => `[bo${i}]`).join('')}`);
    impactos.forEach((t, i) => { const ms = Math.round(Math.max(0, t) * 1000); g.push(`[bo${i}]adelay=${ms}|${ms}[bm${i}]`); mix.push(`bm${i}`); });
  }
  if (bipIn) { g.push(`[${bipIn}]volume='if(${entre},2,0)':eval=frame,aformat=sample_rates=48000:channel_layouts=stereo[bp]`); mix.push('bp'); }
  if (sfxIn) {
    g.push(`[${sfxIn}]highpass=f=500,lowpass=f=5000,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.27,volume=0.5,aformat=sample_rates=48000:channel_layouts=stereo,asplit=${sons.length}${sons.map((_, i) => `[w${i}]`).join('')}`);
    sons.forEach((t, i) => { g.push(`[w${i}]adelay=${Math.round(Math.max(0, t - 0.2) * 1000)}|${Math.round(Math.max(0, t - 0.2) * 1000)}[x${i}]`); mix.push(`x${i}`); });
  }
  if (mix.length === 1) g.push('[a0]anull[a]');
  else g.push(`${mix.map((m) => `[${m}]`).join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0${musIn ? ',alimiter=limit=0.89:level=0' : ''}[a]`);
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
// ganchoSeg: how long the hook stays on top (default 2.5 s; Infinity keeps it the whole cut as a title)
export async function renderCorte({ jogo, camera, audio, start, end, palavras = [], gancho = '', ganchoSeg, selo = '', out, formato, marca = null, config = {}, focos }) {
  const fmt = formato || config.formatoPadrao || 'camtopo';
  const L = layoutFormato(FORMATOS[fmt] ? fmt : 'camtopo', { camPct: fmt === 'camtopo' ? config.camPct : undefined });
  const ass = out.replace(/\.mp4$/, '.ass');
  // jump cuts first (they change the timeline), then framing on the new timeline
  const enx = config.cortarSilencio === false ? { manter: [[0, end - start]], palavras, dur: end - start } : encolherSilencios(palavras, end - start, config.cortarSilencio || {});
  const dur = enx.dur;
  // profanity: masked in the captions and beeped in the sound (config.filtroPalavroes: 'pesado' default, 'todos', false)
  const filtro = filtrarPalavroes(enx.palavras, { nivel: config.filtroPalavroes ?? 'pesado', extras: config.palavroesExtras || [] });
  palavras = filtro.palavras;
  const imp = config.efeitos?.impactos !== true ? [] : impactosDe(palavras, dur, config.efeitos?.impactosOpcoes || {});
  palavras = marcarEnfase(palavras, imp);
  const extras = config.efeitos?.adesivos === false ? [] : assAdesivos(adesivosDe(palavras, dur, config.efeitos?.adesivosOpcoes || {}), L, { cor: marca?.corBarra || '#FFE600' });
  const arqMusica = escolherMusica(path.basename(path.dirname(out)) || out, config.musica);
  focos = focos ?? (config.enquadramento === false || !FORMATOS[fmt]?.semCamera ? null : focosDe(palavras, dur, config.enquadramento || {}));
  const sons = config.efeitos?.whoosh === false || !focos ? [] : focos.filter((f, i) => i > 0 && f.tipo !== 'normal').map((f) => f.de);
  fs.writeFileSync(ass, assOf(cuesOf(palavras), { layout: L, style: config.estilo, hook: gancho, selo, hookSec: Math.min(ganchoSeg ?? config.estilo?.ganchoSeg ?? 2.5, dur), marca: marca?.arroba ? { ...marca, dur, arrobaPos: L.arrobaPos } : null, extras }));
  const logo = marca?.logo && fs.existsSync(marca.logo) ? marca.logo : null;
  const args = argsCorte({ jogo, camera: camera || jogo, audio: audio || jogo, start, end, ass, out, formato: L.formato, regiaoCamera: config.regiaoCamera, camPct: fmt === 'camtopo' ? config.camPct : undefined, zoom: config.zoomJogo, fps: config.fps, offsetCamera: config.offsetCamera, corBarra: marca?.corBarra || config.corBarra, logo,
    focos, manter: enx.manter, sons, impactos: imp.map((m) => m.t), bips: filtro.bips, musica: arqMusica ? { arquivo: arqMusica, volume: config.musica?.volume } : null, encoder: config.encoder || await melhorEncoder() });
  await run('ffmpeg', args, { timeoutMs: 30 * 60000 });
  return out;
}

// cover: one frame of the cut (default: 40% in, usually the reaction)
export async function capa(video, out, t) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60000 });
  return out;
}
