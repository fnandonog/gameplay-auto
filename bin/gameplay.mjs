#!/usr/bin/env node
// gameplay processar <gravação.mp4>   processa uma sessão agora
// gameplay observar                   fica observando a pasta do OBS e processa cada gravação nova (e abre o painel)
// gameplay painel                     só o painel de aprovação
import path from 'node:path';
import { carregarConfig } from '../src/config.js';
import { processarSessao } from '../src/sessao.js';
import { observar } from '../src/observador.js';
import { temFfmpeg } from '../src/run.js';
import { criarPainel, enderecosLocais } from '../src/painel.js';

const [cmd, ...resto] = process.argv.slice(2);
const flags = new Set(resto.filter((a) => a.startsWith('--')));
const args = resto.filter((a) => !a.startsWith('--'));
const config = carregarConfig();
if (flags.has('--sem-ia')) config.semIa = true;

if (!(await temFfmpeg())) { console.error('Falta o ffmpeg. No Mac: brew install ffmpeg'); process.exit(1); }

if (cmd === 'processar' && args[0]) {
  await processarSessao(path.resolve(args[0]), config);
} else if (cmd === 'observar' || cmd === 'painel') {
  const porta = config.portaPainel || 4321;
  criarPainel(config).listen(porta, '0.0.0.0', () => {
    console.log(`Painel: http://localhost:${porta}`);
    for (const u of enderecosLocais(porta)) console.log(`No celular (mesmo Wi-Fi): ${u}${config.senhaPainel ? '/?senha=...' : ''}`);
  });
  if (cmd === 'observar') observar(config);
} else {
  console.log('Uso:\n  gameplay processar <gravação.mp4> [--sem-ia]\n  gameplay observar [--sem-ia]\n  gameplay painel');
  process.exit(cmd ? 1 : 0);
}
