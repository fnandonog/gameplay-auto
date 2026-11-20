// One long YouTube video per mission. Claude looks at one frame every few seconds and says where each mission starts
// (mission title or "CAPÍTULO N" on screen, a call that gives the job, a new objective) and ends (mission passed, the
// last cutscene). Each mission is cut without re-encoding (fast), gets a thumbnail, a title, a description with
// chapters and tags. A mission with nudity or gore on screen is flagged (aviso) and never goes out on its own.
// Needs the AI; without it nothing is made.
import fs from 'node:fs';
import path from 'node:path';
import { clienteIa } from './contaClaude.js';
import { run } from './run.js';
import { MODELO } from './ia.js';
import { textoEntre } from './transcricao.js';
import { assThumb } from './longo.js';
import { fp, FONTS } from './corte.js';
import { registrar } from './atividade.js';

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const SCHEMA_EVENTOS = { type: 'object', additionalProperties: false, required: ['eventos'], properties: { eventos: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['t', 'tipo', 'missao'],
  properties: { t: { type: 'number' }, tipo: { type: 'string', enum: ['inicio', 'fim', 'falha', 'sensivel'] }, missao: { type: 'string' } } } } } };

export const SISTEMA_MISSOES = `Você assiste uma gravação de gameplay quadro a quadro (um quadro a cada poucos segundos, com o tempo em segundos).
Marque só o que aparece na tela:
- inicio: começa uma missão (nome da missão ou "CAPÍTULO N" na tela, ligação/mensagem que passa o trabalho, objetivo novo de missão). Em missao, o nome que aparece (ou um nome curto do objetivo).
- fim: a missão termina ("missão concluída", tela de resultado, última cena antes do jogo livre). Em missao, o mesmo nome.
- falha: a tentativa acabou sem concluir ("missão fracassada", tela de tentar de novo, menu de pausa saindo ou reiniciando a missão, carregar save). Em missao, o nome da missão.
- sensivel: nudez, sexo ou violência explícita na tela (em missao, o que é).
Responda só pelo esquema JSON. Se nada acontece nesses quadros, devolva eventos vazio.`;

// pure: events → missions. A start opens a mission and only an end ("missão concluída") completes it.
// An attempt that fails, is restarted (the same mission starts again after `reinicioSeg`) or is left for another
// mission is abandoned: it never becomes a mission video and its stretch goes to `descartados`, so no cut uses it
// either. The open mission at the end of the recording (he stopped recording mid-mission) is kept as `incompleta`
// and is not rendered. Short ones are dropped.
// Only a restart of the same mission or an explicit failure discards footage, and at most the last `maxDescarteSeg`
// before it (the failed attempt itself, never half the recording). Another mission starting without a "passed" card
// usually means the card was missed: the previous one is kept (no mission video, cuts still allowed).
export function montarMissoes(eventos, duracao, { minSeg = 150, folga = 5, reinicioSeg = 90, maxDescarteSeg = 420 } = {}) {
  const ev = [...eventos].filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  const out = [];
  const descartados = [];
  let atual = null;
  const mesma = (e) => atual && atual.missao.toLowerCase() === String(e.missao || '').trim().toLowerCase();
  const fechar = (fim) => {
    if (atual && fim - atual.inicio >= minSeg) out.push({ ...atual, fim: Math.min(duracao, fim + folga) });
    atual = null;
  };
  const abandonar = (fim, motivo) => {
    if (atual && fim > atual.inicio) descartados.push({ inicio: Math.max(atual.inicio, fim - maxDescarteSeg), fim, missao: atual.missao, motivo });
    atual = null;
  };
  const semFim = (fim) => {
    if (atual && fim - atual.inicio >= minSeg) out.push({ ...atual, fim: Math.min(duracao, fim), incompleta: true, semFim: true });
    atual = null;
  };
  for (const e of ev) {
    if (e.tipo === 'inicio') {
      if (mesma(e) && e.t - atual.visto < reinicioSeg) { atual.visto = e.t; continue; } // same title card, still on screen
      if (atual && mesma(e)) abandonar(e.t - folga, 'reiniciou a missão');
      else if (atual) semFim(e.t - folga);
      atual = { missao: String(e.missao || 'Missão').trim(), inicio: Math.max(0, e.t - folga), visto: e.t, avisos: [] };
    } else if (e.tipo === 'fim' && atual) fechar(e.t);
    else if (e.tipo === 'falha' && atual) abandonar(e.t + folga, 'missão fracassada ou abandonada');
  }
  if (atual && duracao - atual.inicio >= minSeg) out.push({ ...atual, fim: duracao, incompleta: true });
  for (const m of out) delete m.visto;
  for (const s of ev.filter((e) => e.tipo === 'sensivel')) {
    const m = out.find((x) => s.t >= x.inicio && s.t <= x.fim);
    if (m) (m.avisos ||= []).push(`${mmss(s.t - m.inicio)}: ${s.missao}`);
  }
  out.descartados = descartados;
  return out;
}

async function quadros(cena, dir, passo) {
  fs.mkdirSync(dir, { recursive: true });
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-skip_frame', 'nokey', '-i', cena, '-vf', `fps=1/${passo},scale=512:-2`, '-fps_mode', 'vfr', '-q:v', '6', path.join(dir, 'q_%05d.jpg')], { timeoutMs: 60 * 60000 });
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f, i) => ({ t: i * passo, file: path.join(dir, f) }));
}

export async function detectarMissoes({ cena, words = [], duracao, pasta, config = {}, log = console.log, client = null }) {
  let ia = client;
  try { ia ||= clienteIa(); } catch { log('Missões: sem IA, pulei.'); return []; }
  const passo = config.missoes?.passo || 6;
  const dir = path.join(pasta, '.quadros');
  try {
    registrar(config.pastaSaida, 'montador', 'trabalhando', 'Procurando as missões na gravação');
    const qs = await quadros(cena, dir, passo);
    const eventos = [];
    for (let i = 0; i < qs.length; i += 40) {
      const lote = qs.slice(i, i + 40);
      const content = lote.flatMap((q) => [{ type: 'text', text: `t=${q.t}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(q.file).toString('base64') } }]);
      content.push({ type: 'text', text: `Fala do jogador nesse trecho: ${textoEntre(words, lote[0].t, lote.at(-1).t + passo) || '(nada)'}` });
      const msg = await ia.messages.create({ model: MODELO, max_tokens: 4000, system: SISTEMA_MISSOES, output_config: { format: { type: 'json_schema', schema: SCHEMA_EVENTOS } }, messages: [{ role: 'user', content }] });
      const txt = msg.content.find((b) => b.type === 'text')?.text || '{}';
      eventos.push(...(JSON.parse(txt).eventos || []));
    }
    const ms = montarMissoes(eventos, duracao, config.missoes || {});
    for (const d of ms.descartados) log(`Missão "${d.missao}" descartada (${d.motivo}): ${mmss(d.inicio)} a ${mmss(d.fim)}.`);
    return ms;
  } catch (e) { log(`Missões: ${e.message}`); return []; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const SCHEMA_TEXTO = { type: 'object', additionalProperties: false, required: ['titulo', 'descricao', 'tags', 'thumb', 'capitulos'], properties: {
  titulo: { type: 'string' }, descricao: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, thumb: { type: 'string' },
  capitulos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['t', 'nome'], properties: { t: { type: 'number' }, nome: { type: 'string' } } } } } };

async function textosDaMissao(m, words, { jogo = '', client }) {
  const fala = textoEntre(words, m.inicio, m.fim).slice(0, 12000);
  const msg = await client.messages.create({ model: MODELO, max_tokens: 3000, output_config: { format: { type: 'json_schema', schema: SCHEMA_TEXTO } },
    system: 'Você escreve para um canal brasileiro de gameplay no YouTube. Título até 70 caracteres com o nome do jogo e da missão, chamativo e verdadeiro. Descrição: 2 frases e uma pergunta. thumb: 2 a 4 palavras grandes para a thumbnail. capitulos: de 3 a 8, t em segundos desde o início do vídeo (o primeiro em 0), nomes curtos. tags: 5 a 10, minúsculas. Responda só pelo esquema JSON.',
    messages: [{ role: 'user', content: `Jogo: ${jogo}\nMissão: ${m.missao}\nDuração: ${Math.round(m.fim - m.inicio)} s\nFala do jogador (com o tempo da gravação inteira, a missão começa em ${Math.round(m.inicio)} s):\n${fala || '(sem fala)'}` }] });
  return JSON.parse(msg.content.find((b) => b.type === 'text')?.text || '{}');
}

// cuts each mission (stream copy: the OBS scene's video + track 1), writes the thumbnail and the texts
export async function renderMissoes({ cena, video = null, words = [], missoes, pasta, config = {}, log = console.log, client = null }) {
  missoes = missoes.filter((m) => !m.incompleta);
  if (!missoes.length) return [];
  let ia = client;
  try { ia ||= clienteIa(); } catch { return []; }
  fs.mkdirSync(path.join(pasta, 'missoes'), { recursive: true });
  const out = [];
  for (const [i, m] of missoes.entries()) {
    const nome = `missoes/${String(i + 1).padStart(2, '0')}-${slug(m.missao)}`;
    try {
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...(video && video !== cena ? ['-ss', String(m.inicio), '-to', String(m.fim), '-i', video] : []), '-ss', String(m.inicio), '-to', String(m.fim), '-i', cena, '-map', '0:v:0', '-map', video && video !== cena ? '1:a:0' : '0:a:0', '-c', 'copy', '-movflags', '+faststart', path.join(pasta, `${nome}.mp4`)], { timeoutMs: 30 * 60000 });
      const tx = await textosDaMissao(m, words, { jogo: config.jogo, client: ia }).catch(() => ({}));
      const ass = path.join(pasta, `${nome}.ass`);
      fs.writeFileSync(ass, assThumb(tx.thumb || m.missao, config.estilo));
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String((m.inicio + m.fim) / 2), '-i', video || cena, '-frames:v', '1', '-vf', `scale=1280:720,eq=saturation=1.3:contrast=1.1,ass='${fp(ass)}':fontsdir='${fp(FONTS)}'`, '-q:v', '2', path.join(pasta, `${nome}.jpg`)], { timeoutMs: 120000 }).catch(() => null);
      fs.rmSync(ass, { force: true });
      const caps = (tx.capitulos || []).filter((c) => c.t >= 0 && c.t < m.fim - m.inicio).map((c) => `${mmss(c.t)} ${c.nome}`);
      if (caps.length && !caps[0].startsWith('00:00')) caps.unshift('00:00 Início');
      out.push({
        arquivo: `${nome}.mp4`, thumb: fs.existsSync(path.join(pasta, `${nome}.jpg`)) ? `${nome}.jpg` : null, missao: m.missao,
        inicio: +m.inicio.toFixed(1), fim: +m.fim.toFixed(1), duracao: Math.round(m.fim - m.inicio),
        titulo: tx.titulo || `${config.jogo || 'Gameplay'}: ${m.missao}`, descricao: [tx.descricao, caps.length >= 3 ? caps.join('\n') : ''].filter(Boolean).join('\n\n'),
        tags: tx.tags || [], aviso: m.avisos?.length ? `Conteúdo sensível na tela: ${m.avisos.join('; ')}` : null, status: 'aguardando',
      });
      log(`Missão ${i + 1}/${missoes.length}: ${m.missao} (${Math.round((m.fim - m.inicio) / 60)} min)`);
    } catch (e) { log(`Missão "${m.missao}" falhou: ${e.message}`); }
  }
  registrar(config.pastaSaida, 'montador', 'pronto', `${out.length} vídeo(s) de missão prontos`);
  return out;
}
