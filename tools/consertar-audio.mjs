// Fixes the audio timing of cuts rendered before the asetpts fix (19/11): the first ~3 s of sound were stamped inside
// 0.7 s, which YouTube plays as a hiss. Re-encodes only the audio (video is copied). Usage:
//   node tools/consertar-audio.mjs ~/Gameplay/prontos [--aplicar]
// Without --aplicar it only lists the broken files. Keeps a copy as video.antes-audio.mp4 next to each fixed file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
const aplicar = process.argv.includes('--aplicar');
const pts = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-read_intervals', '%+5', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f]).toString().split('\n').map((l) => parseFloat(l)).filter(Number.isFinite);
// broken: 100 AAC frames (2.13 s at 48 kHz) stamped in much less than 2 s
export const quebrado = (t) => t.length > 110 && t[100] - t[0] < 1.6;

const achar = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? achar(path.join(d, e.name)) : /^video\.mp4$/.test(e.name) ? [path.join(d, e.name)] : []));
for (const f of achar(base)) {
  let t; try { t = pts(f); } catch { continue; }
  if (!quebrado(t)) continue;
  console.log(`${aplicar ? 'consertando' : 'quebrado'}: ${f}`);
  if (!aplicar) continue;
  const tmp = f.replace(/\.mp4$/, '.tmp.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', 'asetpts=N/SR/TB,aresample=48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp]);
  fs.copyFileSync(f, f.replace(/\.mp4$/, '.antes-audio.mp4'));
  fs.renameSync(tmp, f);
  console.log(`  ok: ${quebrado(pts(f)) ? 'AINDA QUEBRADO' : 'consertado'}`);
}
