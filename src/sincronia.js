// The Source Record game file can lose time (OBS drops a stretch of it): the 2026-11-19 22-04-59 recording has the game
// file 95 s shorter than the scene, aligned at the start and behind later on. The sound always comes from the scene, so
// the clean game picture has to follow the scene's clock. Here we compare small grey frames of the scene and of the game
// file, find how far behind the game file is along the recording, and build a copy of it on the scene's clock (stretches
// the game file does not have use the scene, blurred, so the face in the corner never shows).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run, probe } from './run.js';
import { encoderArgs, melhorEncoder } from './corte.js';

const LW = 48, LH = 27, PX = LW * LH;

// pure: frames (Uint8 buffer, PX bytes each) → normalized vectors (mean 0, std 1); a flat frame stays zeros
export function normalizar(buf) {
  const n = Math.floor(buf.length / PX), out = [];
  for (let i = 0; i < n; i++) {
    const f = new Float32Array(PX);
    let m = 0; for (let k = 0; k < PX; k++) m += buf[i * PX + k];
    m /= PX;
    let v = 0; for (let k = 0; k < PX; k++) { const d = buf[i * PX + k] - m; f[k] = d; v += d * d; }
    const s = Math.sqrt(v / PX);
    if (s > 2) for (let k = 0; k < PX; k++) f[k] /= s; else f.fill(0);
    out.push(f);
  }
  return out;
}

// pure: the lag (in frames) of `a` inside `b` with the smallest error, or null when the picture is too still or the
// match is not clearly better than the rest (menus, black screens)
export function melhorDesvio(a, b) {
  if (!a.length || b.length < a.length) return null;
  const vivos = a.filter((f) => f.some((x) => x !== 0)).length;
  if (vivos < a.length * 0.6) return null;
  let movimento = 0;
  for (let i = 1; i < a.length; i++) { let d = 0; for (let k = 0; k < PX; k++) d += (a[i][k] - a[i - 1][k]) ** 2; movimento += d / PX; }
  if (movimento / (a.length - 1) < 0.02) return null;
  const erros = [];
  for (let lag = 0; lag + a.length <= b.length; lag++) {
    let e = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i], y = b[lag + i]; for (let k = 0; k < PX; k += 2) e += (x[k] - y[k]) ** 2; }
    erros.push(e / (a.length * PX / 2));
  }
  let best = 0; for (let i = 1; i < erros.length; i++) if (erros[i] < erros[best]) best = i;
  const ordenados = [...erros].sort((x, y) => x - y);
  const mediana = ordenados[Math.floor(ordenados.length / 2)];
  if (erros.length > 5 && !(erros[best] < mediana * 0.5)) return null;
  if (erros[best] > 0.8) return null;
  return { lag: best, erro: erros[best] };
}

// pure: measured points [{t, d}] (scene time, seconds the game file is behind) → pieces on the scene's clock
// [{de, ate, desvio}], desvio null = the game file has nothing for that stretch
export function pedacos(pontos, duracao, tol = 0.25, durJogo = Infinity) {
  const p = pontos.filter((x) => x.d != null).sort((a, b) => a.t - b.t);
  if (!p.length) return [{ de: 0, ate: duracao, desvio: 0 }];
  const out = [];
  let de = 0, d = p[0].d;
  for (let i = 1; i < p.length; i++) {
    if (Math.abs(p[i].d - d) <= tol) continue;
    const salto = p[i].j ?? p[i].t; // where the jump happened (found by bisection), else the later sample
    if (p[i].d > d) { // the game file lost (p[i].d - d) s: that stretch of the scene has no game picture
      const buraco = Math.min(p[i].d - d, salto - de);
      out.push({ de, ate: salto - buraco, desvio: d });
      out.push({ de: salto - buraco, ate: salto, desvio: null });
    } else out.push({ de, ate: salto, desvio: d });
    de = salto; d = p[i].d;
  }
  out.push({ de, ate: duracao, desvio: d });
  // the game file ends before the scene: what is past its end has no game picture
  const fim = [];
  for (const x of out) {
    if (x.desvio == null || x.ate - x.desvio <= durJogo) { fim.push(x); continue; }
    const corte = Math.max(x.de, durJogo + x.desvio);
    fim.push({ ...x, ate: corte }, { de: corte, ate: x.ate, desvio: null });
  }
  return fim.filter((x) => x.ate - x.de > 0.05).map((x) => ({ de: +x.de.toFixed(2), ate: +x.ate.toFixed(2), desvio: x.desvio == null ? null : +x.desvio.toFixed(2) }));
}

// pure: no piece needs a change (the game file follows the scene already)
export const jaSincronizado = (ps) => ps.every((x) => x.desvio != null && Math.abs(x.desvio) < 0.15);

function quadros(file, inicio, dur, fps) {
  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, inicio)), '-t', String(dur), '-i', file, '-an',
      '-vf', `fps=${fps},crop=iw/2:ih/2,scale=${LW}:${LH}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const parts = []; let err = '';
    p.stdout.on('data', (d) => parts.push(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', fail);
    p.on('close', (c) => c === 0 ? ok(normalizar(Buffer.concat(parts))) : fail(new Error(`ffmpeg quadros: ${err.trim()}`)));
  });
}

// how many seconds the game file is behind the scene at scene time t (searching [min, max]), or null
export async function medirDesvio(cena, jogo, t, { min = -5, max = 150, janela = 8, fps = 5 } = {}) {
  const a = await quadros(cena, t, janela, fps);
  const ini = Math.max(0, t - max);
  const b = await quadros(jogo, ini, (t - min + janela) - ini, fps);
  const r = melhorDesvio(a, b);
  if (!r) return null;
  const grosso = t - (ini + r.lag / fps);
  // finer: 25 fps around the coarse answer
  const a2 = await quadros(cena, t, 3, 25);
  const ini2 = Math.max(0, t - grosso - 0.5);
  const b2 = await quadros(jogo, ini2, 4, 25);
  const r2 = melhorDesvio(a2, b2);
  return r2 ? +(t - (ini2 + r2.lag / 25)).toFixed(2) : +grosso.toFixed(2);
}

// samples every `passo` s (near the last answer first, full search when that fails) and bisects each jump
export async function mapaSincronia(cena, jogo, duracao, { passo = 30, log = () => {} } = {}) {
  const pontos = [];
  let ultimo = null;
  const medir = async (t) => {
    if (ultimo != null) {
      const perto = await medirDesvio(cena, jogo, t, { min: ultimo - 3, max: ultimo + 3 }).catch(() => null);
      if (perto != null) return perto;
    }
    return medirDesvio(cena, jogo, t).catch(() => null);
  };
  for (let t = 20; t < duracao - 12; t += passo) {
    const d = await medir(t);
    if (d == null) continue;
    if (ultimo != null && Math.abs(d - ultimo) > 0.25) {
      // bisect between the previous good sample and this one
      let esq = pontos[pontos.length - 1].t, dir = t;
      while (dir - esq > 3) {
        const meio = (esq + dir) / 2;
        const dm = await medirDesvio(cena, jogo, meio, { min: Math.min(ultimo, d) - 3, max: Math.max(ultimo, d) + 3 }).catch(() => null);
        if (dm == null) break;
        if (Math.abs(dm - ultimo) <= Math.abs(dm - d)) esq = meio; else dir = meio;
      }
      pontos.push({ t, d, j: dir });
      log(`Sincronia: o arquivo do jogo passa de ${ultimo.toFixed(1)} s para ${d.toFixed(1)} s de atraso perto de ${Math.round(dir)} s.`);
    } else pontos.push({ t, d });
    ultimo = d;
  }
  return pontos;
}

// the game file on the scene's clock, written to `out` (pieces encoded one by one, then joined without re-encoding)
export async function sincronizarJogo({ cena, jogo, out: saida, ps, config = {} }) {
  const out = path.resolve(saida); // the concat list resolves its entries against its own folder
  const info = await probe(jogo);
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const W = v.width || 1920, H = v.height || 1080;
  const fps = config.fps || 60;
  const enc = encoderArgs(config.encoder || await melhorEncoder());
  const tmp = `${out}.partes`;
  fs.mkdirSync(tmp, { recursive: true });
  const lista = [];
  try {
    for (const [i, p] of ps.entries()) {
      const f = path.join(tmp, `${String(i).padStart(3, '0')}.mp4`);
      const dur = +(p.ate - p.de).toFixed(3);
      const src = p.desvio == null ? cena : jogo;
      const ini = p.desvio == null ? p.de : p.de - p.desvio;
      const vf = `scale=${W}:${H},fps=${fps},format=yuv420p${p.desvio == null ? ',boxblur=40:6' : ''}`;
      // a piece that starts before the game file did (negative start): pad with its first frame
      const pad = ini < 0 ? `,tpad=start_mode=clone:start_duration=${(-ini).toFixed(3)}` : '';
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, ini)), '-t', String(dur), '-i', src, '-an',
        '-vf', vf + pad + `,trim=duration=${dur}`, ...enc, '-r', String(fps), f], { timeoutMs: 60 * 60000 });
      lista.push(`file '${f.replace(/'/g, "'\\''")}'`);
    }
    fs.writeFileSync(path.join(tmp, 'lista.txt'), lista.join('\n'));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'lista.txt'), '-c', 'copy', '-movflags', '+faststart', out], { timeoutMs: 30 * 60000 });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

// whole step: when the game file's length differs from the scene's, measure and (if needed) build the synced copy.
// Returns { jogo, mapa } — jogo is the file to use for the picture.
export async function alinharJogo({ cena, jogo, duracao, pastaDestino, config = {}, log = () => {} }) {
  if (!jogo || jogo === cena || config.sincronizarJogo === false) return { jogo, mapa: null };
  const durJogo = Number((await probe(jogo)).format?.duration) || 0;
  if (!durJogo || Math.abs(durJogo - duracao) <= 1.5) return { jogo, mapa: null };
  log(`O arquivo do jogo tem ${durJogo.toFixed(1)} s e a cena ${duracao.toFixed(1)} s. Medindo onde ele perde tempo...`);
  const pontos = await mapaSincronia(cena, jogo, duracao, { log });
  const ps = pedacos(pontos, duracao, 0.25, durJogo);
  if (jaSincronizado(ps.filter((x) => x.de < durJogo - 1))) { log('Sincronia: o arquivo do jogo acompanha a cena (só termina antes/depois).'); return { jogo, mapa: ps }; }
  fs.mkdirSync(pastaDestino, { recursive: true });
  const out = path.join(pastaDestino, `${path.basename(jogo).replace(/\.\w+$/, '')} sincronizado.mp4`);
  log(`Sincronia: montando o arquivo do jogo no relógio da cena (${ps.length} pedaços).`);
  await sincronizarJogo({ cena, jogo, out, ps, config });
  return { jogo: out, mapa: ps };
}
