// One recorded session → vertical cuts ready to post. Steps: find the files, transcribe the mic, measure the sound,
// pick the moments, let the AI decide the exact cuts and titles, render, write sessao.json.
import fs from 'node:fs';
import path from 'node:path';
import { probe } from './run.js';
import { argsExtrairAudio, transcrever, palavrasEntre } from './transcricao.js';
import { run } from './run.js';
import { candidatos, escolher, capitulosDe, volumePorSegundo } from './momentos.js';
import { decidirCortes } from './ia.js';
import { renderCorte, capa, FORMATOS } from './corte.js';
import { marcaDaLinha } from './marca.js';
import { comIntro } from './intro.js';
import { renderLongo } from './longo.js';
import { registrar } from './atividade.js';
import { linhasDe, distribuirLinhas } from './canais.js';

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

// which formats each cut is rendered in (config.formatos), only the known ones, never empty
export function formatosDoCorte(config = {}) {
  const lista = (Array.isArray(config.formatos) ? config.formatos : [config.formatos || 'meio', 'jogo']).filter((f) => FORMATOS[f]);
  return lista.length ? [...new Set(lista)] : ['meio'];
}

// the format that goes first (and to posting). 'auto': with speech the camera matters (meio a meio); a quiet play is
// better as only the game, bigger.
export function formatoPrincipal(padrao = 'auto', { palavras = 0, formatos = ['meio', 'jogo'] } = {}) {
  if (padrao && padrao !== 'auto' && formatos.includes(padrao)) return padrao;
  const comCamera = formatos.find((f) => !FORMATOS[f].semCamera);
  const soJogo = formatos.find((f) => FORMATOS[f].semCamera);
  return (palavras >= 5 ? comCamera || soJogo : soJogo || comCamera) || formatos[0];
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50);

export async function processarSessao(principal, config, { log = console.log } = {}) {
  const arq = arquivosDaSessao(principal, fs.readdirSync(path.dirname(principal)), config);
  const pasta = path.join(config.pastaSaida, arq.base.replace(/[^\w -]/g, ''));
  fs.mkdirSync(pasta, { recursive: true });
  const at = (agente, estado, texto) => registrar(config.pastaSaida, agente, estado, texto);
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
    at('escriba', 'trabalhando', `Transcrevendo ${arq.base}`);
    await run('ffmpeg', argsExtrairAudio(arq.cena, wav, { track: faixaMic, temTrack: true }));
    words = await transcrever(wav, config.whisper);
    fs.writeFileSync(path.join(pasta, 'transcricao.json'), JSON.stringify(words));
    at('escriba', 'pronto', `${words.length} palavras transcritas`);
  } catch (e) {
    log(`Sem transcrição (${e.message}). Sigo só pelo som e pelos marcadores.`);
    at('escriba', 'erro', `Sem transcrição: ${e.message}`);
  } finally { fs.rmSync(wav, { force: true }); }

  // 2. sound
  log('Medindo o volume...');
  at('cacador', 'trabalhando', 'Medindo o volume e procurando os momentos');
  const volMic = await volumePorSegundo(arq.cena, faixaMic);
  const volJogo = audios > config.faixaJogo ? await volumePorSegundo(arq.cena, config.faixaJogo) : [];

  // 3. candidates → AI
  const cands = escolher(candidatos({ words, capitulos, volMic, volJogo, duracao, config }), config.cortesPorSessao * 2);
  log(`${cands.length} momentos candidatos (${capitulos.length} marcadores do OBS).`);
  at('cacador', 'pronto', `${cands.length} momentos candidatos`);
  at('roteirista', 'trabalhando', 'Escolhendo cortes, ganchos e títulos');
  const decididos = (await decidirCortes(cands, words, { jogo: config.jogo, canal: config.canal, semIa: config.semIa }))
    .sort((a, b) => b.nota - a.nota).slice(0, config.cortesPorSessao);

  at('roteirista', 'pronto', `${decididos.length} cortes escolhidos`);
  // 4. render: each cut goes to its line first, so the video carries that line's @ and colors
  const linhas = linhasDe(config);
  const fila = decididos.map((c, i) => ({ c, i, corte: { nota: c.nota } }));
  distribuirLinhas(fila.map((f) => f.corte), linhas);
  const cortes = [];
  for (const { c, i, corte: { linha: linhaId } } of fila) {
    const nome = `${String(i + 1).padStart(2, '0')}-${slug(c.titulo || 'corte')}`;
    const palavras = palavrasEntre(words, c.start, c.end);
    const linha = linhas.find((l) => l.id === linhaId) || linhas[0];
    const marca = marcaDaLinha(linha, config);
    const formatos = formatosDoCorte(config);
    const principal = formatoPrincipal(config.formatoPadrao, { palavras: palavras.length, formatos });
    log(`Montando corte ${i + 1}/${decididos.length}: ${c.titulo} (${(c.end - c.start).toFixed(0)} s, ${formatos.join(' + ')})`);
    const variantes = {};
    for (const fmt of formatos) {
      at('editor', 'trabalhando', `Corte ${i + 1}/${decididos.length} (${FORMATOS[fmt].nome}): ${c.titulo}`);
      const out = path.join(pasta, `${nome}-${fmt}.mp4`);
      await renderCorte({ jogo: arq.jogo, camera: arq.camera, audio: arq.cena, start: c.start, end: c.end, palavras, gancho: c.gancho, out, formato: fmt, marca, config });
      if (config.intro?.nosCortes) await comIntro(out, { orientacao: 'vertical', marca, config, log });
      variantes[fmt] = path.basename(out);
      // one cover per format, so switching the format on the panel switches the cover too
      await capa(out, out.replace(/\.mp4$/, '.jpg'), Math.min(c.end - c.start - 0.5, (c.end - c.start) * 0.4)).catch(() => null);
    }
    const arquivo = variantes[principal];
    const jpg = fs.existsSync(path.join(pasta, arquivo.replace(/\.mp4$/, '.jpg'))) ? arquivo.replace(/\.mp4$/, '.jpg') : null;
    cortes.push({ arquivo, capa: jpg, formato: principal, variantes, linha: linha.id, arroba: marca?.arroba || '', inicio: +c.start.toFixed(2), fim: +c.end.toFixed(2), nota: c.nota, motivo: c.motivo, gancho: c.gancho, titulo: c.titulo, descricao: c.descricao, hashtags: c.hashtags, status: 'aguardando' });
  }

  at('editor', 'pronto', `${cortes.length} cortes montados`);
  // 5. the full YouTube video
  let longo = null;
  if (config.videoLongo !== false && duracao >= 120) {
    at('montador', 'trabalhando', 'Montando o vídeo do YouTube');
    try { longo = await renderLongo({ cena: arq.cena, words, duracao, momentos: decididos, pasta, config, marca: marcaDaLinha(linhas.find((l) => !l.terceiros) || linhas[0], config), log }); at('montador', 'pronto', 'Vídeo longo pronto'); } catch (e) { log(`Vídeo longo falhou: ${e.message}`); at('montador', 'erro', `Vídeo longo falhou: ${e.message}`); }
  }

  const manifesto = { sessao: arq.base, gravacao: arq.cena, jogo: arq.jogo, camera: arq.camera, duracao, criadoEm: new Date().toISOString(), cortes, longo };
  fs.writeFileSync(path.join(pasta, 'sessao.json'), JSON.stringify(manifesto, null, 2));
  log(`Pronto: ${cortes.length} cortes em ${pasta}`);
  return { pasta, manifesto };
}
