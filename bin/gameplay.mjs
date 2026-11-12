#!/usr/bin/env node
// gameplay processar <gravação.mp4>   processa uma sessão agora
// gameplay observar                   fica observando a pasta do OBS e processa cada gravação nova (e abre o painel)
// gameplay painel                     só o painel de aprovação
// gameplay postar                     entrega (ou agenda, com postagem: 'upload-post') agora os cortes aprovados
// gameplay intro                      gera a intro do canal (vertical e horizontal) para conferir
import path from 'node:path';
import { carregarConfig } from '../src/config.js';
import { processarSessao } from '../src/sessao.js';
import { observar } from '../src/observador.js';
import { temFfmpeg } from '../src/run.js';
import { criarPainel, enderecosLocais } from '../src/painel.js';
import { postarAprovados } from '../src/postagem.js';
import { entregarAprovados } from '../src/entrega.js';
import { gerarIntro } from '../src/intro.js';
import { marcaDaLinha } from '../src/marca.js';
import { linhasDe } from '../src/canais.js';

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
  // every 5 minutes, what was approved on the panel goes out: to the posting skill's folder, or to Upload-Post
  if (config.postagem === 'upload-post') {
    const postar = () => postarAprovados(config).catch((e) => console.log(`Postagem: ${e.message}`));
    if (process.env.UPLOAD_POST_API_KEY && config.uploadPost.perfil) { postar(); setInterval(postar, 5 * 60000); }
    else console.log('Postagem desligada: falta UPLOAD_POST_API_KEY ou uploadPost.perfil no config.json.');
  } else {
    const entregar = () => { try { entregarAprovados(config); } catch (e) { console.log(`Entrega: ${e.message}`); } };
    console.log(`Cortes aprovados vão para ${config.pastaEntrega} (a sua skill de postagem pega de lá).`);
    entregar(); setInterval(entregar, 5 * 60000);
  }
} else if (cmd === 'postar') {
  if (config.postagem === 'upload-post') console.log(`${await postarAprovados(config)} corte(s) agendado(s).`);
  else console.log(`${entregarAprovados(config)} corte(s) entregue(s) em ${config.pastaEntrega}.`);
} else if (cmd === 'intro') {
  for (const linha of linhasDe(config)) {
    const marca = marcaDaLinha(linha, config);
    for (const orientacao of ['vertical', 'horizontal']) console.log(await gerarIntro({ orientacao, marca, config }));
  }
} else {
  console.log('Uso:\n  gameplay processar <gravação.mp4> [--sem-ia]\n  gameplay observar [--sem-ia]\n  gameplay painel\n  gameplay postar\n  gameplay intro');
  process.exit(cmd ? 1 : 0);
}
