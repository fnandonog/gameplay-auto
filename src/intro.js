// The channel's intro: ~1.2 s with the wordmark sliding in over a dark background, a stripe in the brand color and a
// whoosh. Generated once per brand and orientation from docs/marca, cached in <pastaSaida>/.intro/.
// The long video gets it after the preview; the cuts only if config.intro.nosCortes (an intro costs retention on Shorts).
// The intro is encoded with the same settings as the videos, so joining is a stream copy (no second encode).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';
import { encoderArgs, melhorEncoder } from './corte.js';
import { registrar } from './atividade.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TAMANHOS = { vertical: [1080, 1920], horizontal: [1920, 1080] };
export const wordmarkDe = (marca = 'fnando') => path.join(ROOT, 'docs', 'marca', `${marca === 'clipai' ? 'clipai' : 'fnando'}-wordmark.png`);

// ffmpeg arguments of one intro (pure)
export function argsIntro({ logo, orientacao = 'vertical', dur = 1.2, cor = '#FFE600', fundo = '#0B0B0F', fps = 60, encoder = 'libx264', out }) {
  const [W, H] = TAMANHOS[orientacao] || TAMANHOS.vertical;
  const lw = Math.round(W * (orientacao === 'vertical' ? 0.78 : 0.5) / 2) * 2;
  const hex = (c) => `0x${c.replace('#', '')}`;
  const g = [
    `[1:v]scale=${lw}:-1:flags=lanczos,format=rgba,fade=t=in:st=0.1:d=0.3:alpha=1,fade=t=out:st=${(dur - 0.2).toFixed(2)}:d=0.2:alpha=1[lg]`,
    `[0:v][2:v]overlay=x='-w+(w+W)*min(1\\,max(0\\,(t-0.05)/0.45))':y=H/2+${Math.round(H * 0.06)}:eval=frame[bg]`,
    `[bg][lg]overlay=x=(W-w)/2:y='(H-h)/2-${Math.round(H * 0.02)}+${Math.round(H * 0.03)}*max(0\\,1-t/0.4)':eval=frame,fade=t=out:st=${(dur - 0.12).toFixed(2)}:d=0.12,format=yuv420p,setsar=1[v]`,
    `[3:a]highpass=f=300,lowpass=f=5000,afade=t=in:d=0.3,afade=t=out:st=0.35:d=${(dur - 0.35).toFixed(2)},volume=0.35,aformat=sample_rates=48000:channel_layouts=stereo[a]`,
  ];
  return ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${hex(fundo)}:s=${W}x${H}:r=${fps}:d=${dur}`,
    '-loop', '1', '-t', String(dur), '-i', logo,
    '-f', 'lavfi', '-i', `color=c=${hex(cor)}:s=${W}x${Math.round(H * 0.012)}:r=${fps}:d=${dur}`,
    '-f', 'lavfi', '-i', `anoisesrc=d=${dur}:c=pink:r=48000:a=0.6`,
    '-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]', ...encoderArgs(encoder), '-r', String(fps), '-t', String(dur),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out];
}

// concat demuxer list joining files without re-encoding (pure)
export const listaJuntar = (arquivos) => `ffconcat version 1.0\n${arquivos.map((a) => `file '${a.replace(/'/g, "'\\''")}'`).join('\n')}\n`;

// the intro file for a brand/orientation; generated when missing
export async function gerarIntro({ orientacao = 'vertical', marca = null, config = {}, log = console.log } = {}) {
  const qual = marca?.marca || 'fnando';
  const dir = path.join(config.pastaSaida || '.', '.intro');
  fs.mkdirSync(dir, { recursive: true });
  const fps = config.fps || 60;
  const encoder = config.encoder || await melhorEncoder();
  const out = path.join(dir, `intro-${qual}-${orientacao}-${fps}-${encoder}.mp4`);
  if (fs.existsSync(out)) return out;
  const logo = config.intro?.logo || wordmarkDe(qual);
  log(`Gerando a intro ${qual} (${orientacao})...`);
  if (config.pastaSaida) registrar(config.pastaSaida, 'editor', 'trabalhando', `Gerando a intro ${qual} (${orientacao})`);
  await run('ffmpeg', argsIntro({ logo, orientacao, dur: config.intro?.duracao || 1.2, cor: marca?.cor || '#FFE600', fps, encoder, out }), { timeoutMs: 120000 });
  return out;
}

// puts the intro in front of a finished video, in place (same encoding settings, so a stream copy)
export async function comIntro(video, { orientacao = 'vertical', marca = null, config = {}, log } = {}) {
  const intro = await gerarIntro({ orientacao, marca, config, log });
  await juntar([intro, video], video);
  return video;
}

// joins finished files (same codec/size/fps) into out, which may be one of them
export async function juntar(arquivos, out) {
  const tmp = `${out}.junto.mp4`;
  const lista = `${out}.ffconcat`;
  fs.writeFileSync(lista, listaJuntar(arquivos.map((a) => path.resolve(a))));
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', tmp], { timeoutMs: 30 * 60000 });
    fs.renameSync(tmp, out);
  } finally { fs.rmSync(lista, { force: true }); fs.rmSync(tmp, { force: true }); }
  return out;
}
