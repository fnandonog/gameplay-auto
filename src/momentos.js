// Finds the best moments of a session: what the player marked (voice command, OBS chapter marker) first, then what the
// sound and the words say (a scream, laughter, "não acredito"). Pure functions, except volumePorSegundo (runs ffmpeg).
import { run } from './run.js';

// ---------- loudness ----------
// ffmpeg prints the RMS level of each 1 s block; returns [dB, dB, ...] (index = second).
export function argsVolume(video, stream) {
  return ['-hide_banner', '-nostats', '-i', video, '-map', `0:a:${stream}`, '-vn',
    '-af', 'aresample=8000,asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-'];
}
export function parseVolume(txt) {
  const out = [];
  for (const m of String(txt).matchAll(/RMS_level=(-?[\d.]+|-inf|inf)/g)) out.push(m[1].includes('inf') ? -90 : Math.max(-90, Number(m[1])));
  return out;
}
export async function volumePorSegundo(video, stream) {
  try { return parseVolume(await run('ffmpeg', argsVolume(video, stream), { timeoutMs: 2 * 3600000 })); } catch { return []; }
}

// z-score of each second against the session (robust: median and MAD), ignoring silence
export function zScores(db) {
  const vivos = db.filter((v) => v > -60).sort((a, b) => a - b);
  if (vivos.length < 10) return db.map(() => 0);
  const med = vivos[Math.floor(vivos.length / 2)];
  // floor of 1.5 dB: a steady track (menu music) would turn tiny wobbles into "peaks"
  const mad = Math.max(1.5, [...vivos.map((v) => Math.abs(v - med))].sort((a, b) => a - b)[Math.floor(vivos.length / 2)]);
  return db.map((v) => (v <= -60 ? 0 : (v - med) / (1.4826 * mad)));
}

// local peaks above z, at least gap seconds apart, strongest first
export function picos(z, { min = 2.2, gap = 45, max = 30 } = {}) {
  const cand = z.map((v, t) => ({ t, v })).filter((p) => p.v >= min).sort((a, b) => b.v - a.v);
  const out = [];
  for (const p of cand) { if (out.every((o) => Math.abs(o.t - p.t) >= gap)) out.push(p); if (out.length >= max) break; }
  return out;
}

// ---------- words ----------
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');

export const COMANDOS = ['clipa isso', 'clipa ai', 'clipa', 'clip isso', 'marca isso', 'marca ai', 'corta isso', 'salva isso'];
export const EMOCAO = ['nao acredito', 'meu deus', 'caraca', 'caramba', 'que isso', 'olha isso', 'nossa', 'socorro', 'vai vai vai', 'gol', 'kkk', 'hahaha', 'ai meu deus', 'mds', 'pqp', 'inacreditavel', 'absurdo', 'lendario', 'clutch', 'ganhei', 'perdi'];

// Finds phrases in the word list. Returns [{ frase, start, end, i }] (start/end of the phrase).
export function acharFrases(words, frases) {
  const toks = words.map((w) => norm(w.text));
  const lista = frases.map((f) => ({ f, partes: norm(f).split(' ') })).sort((a, b) => b.partes.length - a.partes.length);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    for (const { f, partes } of lista) {
      if (partes.every((p, k) => toks[i + k] !== undefined && (p === 'kkk' ? /^k{3,}$/.test(toks[i + k]) : p === 'hahaha' ? /^(ha){3,}/.test(toks[i + k]) : toks[i + k] === p))) {
        out.push({ frase: f, start: words[i].start, end: words[i + partes.length - 1].end, i });
        i += partes.length - 1;
        break;
      }
    }
  }
  return out;
}

// ---------- candidates ----------
// Each candidate is a window [start, end] with a score and why it was picked.
export function candidatos({ words = [], capitulos = [], volMic = [], volJogo = [], duracao, config = {} }) {
  const antes = config.segundosAntes ?? 40, depois = config.segundosDepois ?? 8;
  const out = [];
  // 1. voice command: the cut ends just before "clipa isso", so the command doesn't show
  for (const c of acharFrases(words, COMANDOS)) out.push({ start: c.start - antes, end: c.start - 0.2, nota: 10, motivo: `comando de voz "${c.frase}"`, fixo: true });
  // 2. OBS chapter marker (hotkey or Bluetooth button)
  for (const t of capitulos) out.push({ start: t - antes, end: t + 3, nota: 9, motivo: 'marcador do OBS', fixo: true });
  // 3. a scream or a loud reaction on the mic
  for (const p of picos(zScores(volMic))) out.push({ start: p.t - 25, end: p.t + 10, nota: Math.min(8, 4 + p.v), motivo: 'reação forte no microfone', t: p.t });
  // 4. a loud moment in the game (explosion, goal, crowd)
  for (const p of picos(zScores(volJogo), { min: 2.8 })) out.push({ start: p.t - 20, end: p.t + 8, nota: Math.min(7, 3 + p.v), motivo: 'pico de som do jogo', t: p.t });
  // 5. emotion words raise what is near them, or become candidates on their own
  for (const e of acharFrases(words, EMOCAO)) {
    const perto = out.find((c) => !c.fixo && e.start >= c.start && e.start <= c.end);
    if (perto) { perto.nota += 1.5; perto.motivo += ` + "${e.frase}"`; } else out.push({ start: e.start - 20, end: e.end + 6, nota: 5, motivo: `fala "${e.frase}"`, t: e.start });
  }
  const fim = duracao || Infinity;
  return mesclar(out.map((c) => {
    let start = Math.max(0, c.start), end = Math.min(fim, c.end);
    if (end - start < 15) { start = Math.max(0, end - 15); end = Math.min(fim, start + 15); } // a cut shorter than 15 s doesn't hold anyone
    return { ...c, start, end };
  }).filter((c) => c.end - c.start >= 8));
}

// overlapping windows become one, keeping the best score and both reasons
export function mesclar(lista) {
  const ord = [...lista].sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of ord) {
    const ult = out.at(-1);
    if (ult && c.start < ult.end - 3) {
      ult.end = Math.max(ult.end, c.end);
      if (c.nota > ult.nota) { ult.nota = c.nota; }
      ult.fixo = ult.fixo || c.fixo;
      if (!ult.motivo.includes(c.motivo)) ult.motivo += `; ${c.motivo}`;
    } else out.push({ ...c });
  }
  // a merged window longer than maxSec is trimmed around its end (where the action usually is)
  return out.map((c) => (c.end - c.start > 75 ? { ...c, start: c.end - 75 } : c));
}

// the best n, marked ones always in, returned in time order
export function escolher(lista, n = 6) {
  const fixos = lista.filter((c) => c.fixo);
  const resto = lista.filter((c) => !c.fixo).sort((a, b) => b.nota - a.nota).slice(0, Math.max(0, n - fixos.length));
  return [...fixos, ...resto].sort((a, b) => a.start - b.start);
}

// chapter marker times (s) from ffprobe's JSON
export const capitulosDe = (probeJson) => (probeJson?.chapters || []).map((c) => Number(c.start_time)).filter((t) => t > 1);
