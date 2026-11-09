// One recorded session → vertical cuts ready to post. Steps: find the files, transcribe the mic, measure the sound,
// pick the moments, let the AI decide the exact cuts and titles, render, write sessao.json.
import fs from 'node:fs';
import path from 'node:path';
import { probe } from './run.js';
import { argsExtrairAudio, transcrever, palavrasEntre } from './transcricao.js';
import { run } from './run.js';
import { candidatos, escolher, capitulosDe, volumePorSegundo } from './momentos.js';
import { decidirCortes } from './ia.js';
import { renderCorte, capa } from './corte.js';
import { renderLongo } from './longo.js';

const VIDEO = /\.(mp4|mkv|mov)$/i;
const tem = (nome, lista) => lista.some((p) => nome.toLowerCase().includes(p));

// The session's files. OBS writes "2026-11-09 21-30-00.mp4" (the scene) and, with Source Record,
// "2026-11-09 21-30-00 camera.mp4" and "... jogo.mp4". Without the extra files the scene is used for both.
export function arquivosDaSessao(principal, irmaos, config) {
  const base = path.basename(principal).replace(VIDEO, '');
  const dir = path.dirname(principal);
  const daSessao = irmaos.filter((f) => VIDEO.test(f) && f !== path.basename(principal) && f.startsWith(base));
  const camera = daSessao.find((f) => tem(f.slice(base.length), config.nomesCamera));
  const jogo = daSessao.find((f) => tem(f.slice(base.length), config.nomesJogo));
  return {
    base,
    cena: principal,
    jogo: jogo ? path.join(dir, jogo) : principal,
    camera: camera ? path.join(dir, camera) : principal,
    separados: !!(camera && jogo),
  };
}

// a recording that is only the extra file of another one (Source Record) is not a session of its own
export function ehArquivoExtra(nome, todos) {
  const b = nome.replace(VIDEO, '');
  return todos.some((o) => o !== nome && VIDEO.test(o) && b.length > o.replace(VIDEO, '').length && b.startsWith(o.replace(VIDEO, '')));
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50);

export async function processarSessao(principal, config, { log = console.log } = {}) {
  const arq = arquivosDaSessao(principal, fs.readdirSync(path.dirname(principal)), config);
  const pasta = path.join(config.pastaSaida, arq.base.replace(/[^\w -]/g, ''));
  fs.mkdirSync(pasta, { recursive: true });
  log(`Sessão ${arq.base}: ${arq.separados ? 'jogo e câmera em arquivos separados' : 'só a cena (câmera recortada da cena)'}`);

  const info = await probe(arq.cena);
  const duracao = Number(info.format?.duration) || 0;
  const audios = (info.streams || []).filter((s) => s.codec_type === 'audio').length;
  const capitulos = capitulosDe(info);
  if (!audios) throw new Error('A gravação não tem áudio. Confira as faixas de áudio no OBS.');

  // 1. transcription of the mic track
  let words = [];
  const wav = path.join(pasta, 'mic.wav');
  const faixaMic = audios > config.faixaMic ? config.faixaMic : 0;
  try {
    log('Transcrevendo a fala...');
    await run('ffmpeg', argsExtrairAudio(arq.cena, wav, { track: faixaMic, temTrack: true }));
    words = await transcrever(wav, config.whisper);
    fs.writeFileSync(path.join(pasta, 'transcricao.json'), JSON.stringify(words));
  } catch (e) {
    log(`Sem transcrição (${e.message}). Sigo só pelo som e pelos marcadores.`);
  } finally { fs.rmSync(wav, { force: true }); }

  // 2. sound
  log('Medindo o volume...');
  const volMic = await volumePorSegundo(arq.cena, faixaMic);
  const volJogo = audios > config.faixaJogo ? await volumePorSegundo(arq.cena, config.faixaJogo) : [];

  // 3. candidates → AI
  const cands = escolher(candidatos({ words, capitulos, volMic, volJogo, duracao, config }), config.cortesPorSessao * 2);
  log(`${cands.length} momentos candidatos (${capitulos.length} marcadores do OBS).`);
  const decididos = (await decidirCortes(cands, words, { jogo: config.jogo, canal: config.canal, semIa: config.semIa }))
    .sort((a, b) => b.nota - a.nota).slice(0, config.cortesPorSessao);

  // 4. render
  const cortes = [];
  for (const [i, c] of decididos.entries()) {
    const nome = `${String(i + 1).padStart(2, '0')}-${slug(c.titulo || 'corte')}`;
    const out = path.join(pasta, `${nome}.mp4`);
    log(`Montando corte ${i + 1}/${decididos.length}: ${c.titulo} (${(c.end - c.start).toFixed(0)} s)`);
    await renderCorte({ jogo: arq.jogo, camera: arq.camera, audio: arq.cena, start: c.start, end: c.end, palavras: palavrasEntre(words, c.start, c.end), gancho: c.gancho, out, config });
    const jpg = await capa(out, out.replace(/\.mp4$/, '.jpg'), Math.min(c.end - c.start - 0.5, (c.end - c.start) * 0.4)).catch(() => null);
    cortes.push({ arquivo: path.basename(out), capa: jpg && path.basename(jpg), inicio: +c.start.toFixed(2), fim: +c.end.toFixed(2), nota: c.nota, motivo: c.motivo, gancho: c.gancho, titulo: c.titulo, descricao: c.descricao, hashtags: c.hashtags, status: 'aguardando' });
  }

  // 5. the full YouTube video
  let longo = null;
  if (config.videoLongo !== false && duracao >= 120) {
    try { longo = await renderLongo({ cena: arq.cena, words, duracao, momentos: decididos, pasta, config, log }); } catch (e) { log(`Vídeo longo falhou: ${e.message}`); }
  }

  const manifesto = { sessao: arq.base, gravacao: arq.cena, jogo: arq.jogo, camera: arq.camera, duracao, criadoEm: new Date().toISOString(), cortes, longo };
  fs.writeFileSync(path.join(pasta, 'sessao.json'), JSON.stringify(manifesto, null, 2));
  log(`Pronto: ${cortes.length} cortes em ${pasta}`);
  return { pasta, manifesto };
}
