// Watches the OBS folder. A recording is ready when its size stops changing for `estavelSeg` seconds (OBS finished
// writing); then the session is processed and its files move to pastaProcessados.
import fs from 'node:fs';
import path from 'node:path';
import { processarSessao, ehArquivoExtra, arquivosDaSessao } from './sessao.js';
import { registrar } from './atividade.js';
import { pastaDaGravacao } from './central.js';
import { execFile } from 'node:child_process';

const VIDEO = /\.(mp4|mkv|mov)$/i;

// Live mode (config.aoVivo.ligado): OBS splits the recording every few minutes (Gravação > Dividir arquivo
// automaticamente) and each block is cut as soon as OBS closes it, while the live goes on. A block gives fewer cuts, no
// long video, and may use a lighter transcription model so the Mac keeps up with the stream. A Replay Buffer file
// ("Replay ...mp4", the "save the last 60 s" key) gives exactly one cut. (pure)
export function configDoArquivo(nome, config) {
  const av = config.aoVivo || {};
  if (/^replay/i.test(nome)) return { ...config, cortesPorSessao: 1, videoLongo: false, ...(av.ligado ? { whisper: { ...config.whisper, ...(av.whisper || {}) } } : {}) };
  if (!av.ligado) return config;
  return { ...config, cortesPorSessao: av.cortesPorBloco ?? 2, videoLongo: false, whisper: { ...config.whisper, ...(av.whisper || {}) } };
}

// pure: given sizes seen now and before, which files are ready
export function prontos(agora, antes, desde, now, estavelMs) {
  const out = [];
  for (const [f, size] of Object.entries(agora)) {
    if (antes[f] !== size) { desde[f] = now; continue; }
    if (size > 0 && now - (desde[f] ?? now) >= estavelMs) out.push(f);
  }
  return out;
}

// OBS still has the file open (recording in progress): a hybrid MP4 can stay the same size for a while mid-recording,
// so the size alone is not enough. macOS/Linux `lsof`; when lsof is missing the answer is "not open".
export function arquivoAberto(file) {
  return new Promise((resolve) => execFile('lsof', ['-t', '--', file], { timeout: 10000 }, (err, out) => resolve(!err && String(out).trim().length > 0)));
}

export function observar(config, { estavelSeg = config.aoVivo?.ligado ? 15 : 90, aberto = arquivoAberto, intervaloSeg = config.aoVivo?.ligado ? 5 : 10, log = console.log } = {}) {
  fs.mkdirSync(config.pastaEntrada, { recursive: true });
  fs.mkdirSync(config.pastaProcessados, { recursive: true });
  registrar(config.pastaSaida, 'vigia', 'esperando', 'De olho na pasta do OBS');
  log(`Observando ${config.pastaEntrada}. Grave no OBS e os cortes aparecem em ${config.pastaSaida}.`);
  let antes = {}; const desde = {}; let ocupado = false; const falhas = new Set();
  const tick = async () => {
    if (ocupado) return;
    const nomes = fs.readdirSync(config.pastaEntrada).filter((f) => VIDEO.test(f) && !f.startsWith('.'));
    const agora = Object.fromEntries(nomes.map((f) => [f, fs.statSync(path.join(config.pastaEntrada, f)).size]));
    const estaveis = prontos(agora, antes, desde, Date.now(), estavelSeg * 1000);
    antes = agora;
    const ok = [];
    for (const f of estaveis) if (!(await aberto(path.join(config.pastaEntrada, f)))) ok.push(f); else desde[f] = Date.now();
    const sessoes = ok.filter((f) => !ehArquivoExtra(f, nomes) && !falhas.has(f));
    if (!sessoes.length) return;
    ocupado = true;
    for (const f of sessoes) {
      const principal = path.join(config.pastaEntrada, f);
      try {
        const arq = arquivosDaSessao(principal, nomes, config);
        // already cut (by hand or by an earlier run): don't redo it, just file the recording away
        if (fs.existsSync(path.join(config.pastaSaida, pastaDaGravacao(f), 'sessao.json'))) {
          for (const p of new Set([arq.cena, arq.jogo, arq.camera])) fs.renameSync(p, path.join(config.pastaProcessados, path.basename(p)));
          log(`${f} já tem cortes; foi para ${config.pastaProcessados}.`);
          continue;
        }
        // the extra files must be finished too
        if ([arq.jogo, arq.camera].some((p) => !ok.includes(path.basename(p)))) continue;
        registrar(config.pastaSaida, 'vigia', 'trabalhando', `Gravação nova: ${f}`);
        await processarSessao(principal, configDoArquivo(f, config), { log });
        registrar(config.pastaSaida, 'vigia', 'esperando', `${f} processada. De olho na pasta do OBS`);
        for (const p of new Set([arq.cena, arq.jogo, arq.camera])) fs.renameSync(p, path.join(config.pastaProcessados, path.basename(p)));
      } catch (e) {
        falhas.add(f);
        log(`Falhou ${f}: ${e.message}`);
        registrar(config.pastaSaida, 'vigia', 'erro', `Falhou ${f}: ${e.message}`);
      }
    }
    ocupado = false;
  };
  const timer = setInterval(() => tick().catch((e) => { ocupado = false; log(e.message); }), intervaloSeg * 1000);
  tick();
  return () => clearInterval(timer);
}
