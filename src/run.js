// Runs a command line tool (ffmpeg, ffprobe, whisper-cli) and returns its stdout.
import { spawn } from 'node:child_process';

const DICA = {
  ffmpeg: 'brew install ffmpeg',
  ffprobe: 'brew install ffmpeg',
  'whisper-cli': 'brew install whisper-cpp',
};

export function run(cmd, args, { timeoutMs = 30 * 60000, stderr = false } = {}) {
  return new Promise((ok, fail) => {
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return fail(e); }
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = stderr ? err + d : (err + d).slice(-4000); });
    p.on('error', (e) => {
      clearTimeout(timer);
      fail(e.code === 'ENOENT' ? new Error(`${cmd} não está instalado${DICA[cmd] ? ` (no Mac: ${DICA[cmd]})` : ''}.`) : e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) ok(stderr ? { out, err } : out);
      else fail(new Error(`${cmd} falhou (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`));
    });
  });
}

export async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file], { timeoutMs: 60000 });
  return JSON.parse(out);
}

export const temFfmpeg = () => run('ffmpeg', ['-version'], { timeoutMs: 10000 }).then(() => true, () => false);
