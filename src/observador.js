// Watches the OBS folder. A recording is ready when its size stops changing for `estavelSeg` seconds (OBS finished
// writing); then the session is processed and its files move to pastaProcessados.
import fs from 'node:fs';
import path from 'node:path';
import { processarSessao, ehArquivoExtra, arquivosDaSessao } from './sessao.js';
import { registrar } from './atividade.js';

const VIDEO = /\.(mp4|mkv|mov)$/i;

// pure: given sizes seen now and before, which files are ready
export function prontos(agora, antes, desde, now, estavelMs) {
  const out = [];
  for (const [f, size] of Object.entries(agora)) {
    if (antes[f] !== size) { desde[f] = now; continue; }
    if (size > 0 && now - (desde[f] ?? now) >= estavelMs) out.push(f);
  }
  return out;
}

export function observar(config, { estavelSeg = 30, intervaloSeg = 10, log = console.log } = {}) {
  fs.mkdirSync(config.pastaEntrada, { recursive: true });
  fs.mkdirSync(config.pastaProcessados, { recursive: true });
  registrar(config.pastaSaida, 'vigia', 'esperando', 'De olho na pasta do OBS');
  log(`Observando ${config.pastaEntrada}. Grave no OBS e os cortes aparecem em ${config.pastaSaida}.`);
  let antes = {}; const desde = {}; let ocupado = false; const falhas = new Set();
  const tick = async () => {
    if (ocupado) return;
    const nomes = fs.readdirSync(config.pastaEntrada).filter((f) => VIDEO.test(f) && !f.startsWith('.'));
    const agora = Object.fromEntries(nomes.map((f) => [f, fs.statSync(path.join(config.pastaEntrada, f)).size]));
    const ok = prontos(agora, antes, desde, Date.now(), estavelSeg * 1000);
    antes = agora;
    const sessoes = ok.filter((f) => !ehArquivoExtra(f, nomes) && !falhas.has(f));
    if (!sessoes.length) return;
    ocupado = true;
    for (const f of sessoes) {
      const principal = path.join(config.pastaEntrada, f);
      try {
        const arq = arquivosDaSessao(principal, nomes, config);
        // the extra files must be finished too
        if ([arq.jogo, arq.camera].some((p) => !ok.includes(path.basename(p)))) continue;
        registrar(config.pastaSaida, 'vigia', 'trabalhando', `Gravação nova: ${f}`);
        await processarSessao(principal, config, { log });
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
