// The editor's judgment: Claude reads each candidate's transcript and decides the exact cut, the hook and the titles.
// Without ANTHROPIC_API_KEY (or a profile from `ant auth login`) the pipeline still runs with simple defaults.
import Anthropic from '@anthropic-ai/sdk';
import { clienteIa } from './contaClaude.js';
import { textoEntre } from './transcricao.js';

export const MODELO = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cortes'],
  properties: {
    cortes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'usar', 'inicio', 'fim', 'nota', 'gancho', 'titulo', 'descricao', 'hashtags', 'serie'],
        properties: {
          id: { type: 'integer' },
          usar: { type: 'boolean' },
          inicio: { type: 'number' },
          fim: { type: 'number' },
          nota: { type: 'number' },
          gancho: { type: 'string' },
          titulo: { type: 'string' },
          descricao: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          serie: { type: 'string' },
        },
      },
    },
  },
};

export const SISTEMA = `Você é o editor de um canal brasileiro de gameplay que vive de cortes curtos (TikTok, Reels, YouTube Shorts).
Recebe trechos candidatos de uma sessão gravada, com a transcrição do que o jogador falou e o motivo da escolha.
Para cada trecho decida:
- usar: false se não tem nada que prenda alguém que não conhece o jogador (silêncio, menu, conversa sem graça).
- inicio e fim em segundos da sessão, dentro da janela recebida, com 20 a 60 s. Comece o mais perto possível da ação,
  sem contexto morto, e termine logo depois da reação (risada, grito, frase de impacto). Nunca corte no meio de uma frase.
- nota de 0 a 10: o quanto esse corte segura quem está rolando o feed.
- gancho: o título que fica escrito em cima do vídeo inteiro, 4 a 9 palavras em português. Funciona melhor como
  curiosidade ("DÁ ATÉ PRA DESENTUPIR PIA NO GTA 6") ou pergunta ("O JASON TEM O PODER DO FRANKLIN?"), com o nome do
  jogo quando couber. Tem que ser cumprido pelo vídeo; nada de mentira, que derruba a retenção.
- titulo: até 70 caracteres para a legenda do post, chamativo, pode ter MAIÚSCULAS em uma ou duas palavras e no máximo 1 emoji.
- serie: se o corte cabe numa série que dá para continuar em outros vídeos, o nome curto dela
  ("Coisas que dá pra fazer no GTA 6", "Dicas de GTA 6", "Detalhes absurdos do GTA 6"); senão "".
- descricao: 1 ou 2 frases e uma pergunta para puxar comentário.
- Nunca use palavrão, ofensa ou xingamento no gancho, no título nem na descrição. Não escolha (usar: false) trecho em que a
  fala tem ofensa racista, homofóbica ou contra alguém; palavrão comum na fala tudo bem, a edição coloca bipe.
- hashtags: 3 a 5, do jogo e do formato (sem #, minúsculas).
Responda só pelo esquema JSON.`;

export function montarPedido(cands, words, { jogo = '', canal = '' } = {}) {
  const partes = cands.map((c, id) => [
    `### Trecho ${id}`,
    `janela: ${c.start.toFixed(1)} a ${c.end.toFixed(1)} s · motivo: ${c.motivo} · nota prévia: ${c.nota.toFixed(1)}`,
    `fala: ${textoEntre(words, c.start, c.end) || '(sem fala)'}`,
  ].join('\n'));
  return `${jogo ? `Jogo: ${jogo}\n` : ''}${canal ? `Canal: ${canal}\n` : ''}\n${partes.join('\n\n')}`;
}

// keeps Claude's answer inside each window and within 15..75 s
export function aplicarDecisoes(cands, cortes) {
  const out = [];
  for (const d of cortes || []) {
    const c = cands[d.id];
    if (!c || (!d.usar && !c.obrigatorio)) continue;
    // a stretch the owner asked for keeps its whole window (what matters there may be on screen, not in the talk)
    let start = c.obrigatorio ? c.start : Math.max(c.start, Math.min(d.inicio, c.end - 15));
    let end = c.obrigatorio ? c.end : Math.min(c.end, Math.max(d.fim, start + 15));
    if (end - start > 75) end = start + 75;
    out.push({ ...c, start, end, nota: d.nota, gancho: d.gancho, titulo: d.titulo, descricao: d.descricao, hashtags: d.hashtags, serie: d.serie || '' });
  }
  // a stretch the owner asked for (trechos fixos) is never left out, even when the AI skipped it
  for (const c of cands) {
    if (!c.obrigatorio || out.some((o) => o.start < c.end && o.end > c.start)) continue;
    out.push({ ...c, nota: c.nota ?? 9, gancho: c.gancho || 'OLHA O QUE EU ACHEI', titulo: c.titulo || TITULO_SEM_IA, descricao: c.descricao || 'Você já tinha visto isso? Comenta aí!', hashtags: c.hashtags || ['gta6', 'gameplay', 'ps5'], serie: '' });
  }
  return out;
}

// marked semIa: such cuts never pass the automatic filter (src/qualidade.js); the owner titles and approves them in /cortes
export const TITULO_SEM_IA = 'Não acredito no que aconteceu 😱';
export function semIa(cands) {
  return cands.map((c) => ({ ...c, semIa: true, gancho: c.fixo ? 'OLHA ISSO' : 'NÃO ESPERAVA ESSA', titulo: TITULO_SEM_IA, descricao: 'Você teria feito igual? Comenta aí!', hashtags: ['gameplay', 'ps5', 'gamer'] }));
}

export async function decidirCortes(cands, words, opts = {}) {
  if (!cands.length) return [];
  if (opts.semIa) return semIa(cands);
  let client;
  try { client = clienteIa(); } catch { return semIa(cands); }
  try {
    const stream = client.messages.stream({
      model: MODELO,
      max_tokens: 32000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: montarPedido(cands, words, opts) }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal' || msg.stop_reason === 'max_tokens') return semIa(cands);
    const txt = msg.content.find((b) => b.type === 'text')?.text || '{}';
    return aplicarDecisoes(cands, JSON.parse(txt).cortes);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.warn('Sem chave da Anthropic: usando títulos padrão.');
    else console.warn(`IA indisponível (${e.message}); usando títulos padrão.`);
    return semIa(cands);
  }
}

// Speech review of one cut (the owner asked: "deixa as IAs verem se precisa cortar algo"): the AI reads the numbered
// words and returns what to drop — retakes said again later ("vamos ligar pro mecânico... vamos ligar pro nosso
// mecânico"), false starts, stalling and talk that goes nowhere. Never the hook line nor more than 35 % of the words.
export const SISTEMA_FALA = `Você é o editor de cortes curtos de gameplay de um canal brasileiro. Recebe a fala de UM corte, palavra por palavra, numerada.
Marque só o que deve SAIR para o corte ficar mais rápido e limpo:
- frase repetida/recomeçada: quando a mesma ideia é dita de novo, tire a PRIMEIRA tentativa e mantenha a última (a mais completa);
- começos falsos, travadas, "é...", "tipo assim", enrolação sem informação;
- fala que não tem nada a ver com o que acontece no corte.
Nunca tire a reação forte (o momento), nem o fim de uma frase que fica de pé sozinha, nem palavrão (é bipado depois). Na dúvida, não tire.
Responda só com os intervalos de índices (inclusive) a remover.`;
const SCHEMA_FALA = { type: 'object', additionalProperties: false, required: ['remover'], properties: { remover: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['de', 'ate'], properties: { de: { type: 'integer' }, ate: { type: 'integer' }, motivo: { type: 'string' } } } } } };

export const montarFala = (palavras) => palavras.map((w, i) => `${i}:${String(w.text).trim()}`).join(' ');

// pure: index ranges from the AI → seconds to cut. Drops bad ranges and gives up when it would cut too much.
export function aplicarRevisaoFala(palavras, remover = [], { maxFracao = 0.35, protegerInicio = 3 } = {}) {
  const tira = new Set();
  for (const r of remover || []) {
    const de = Math.max(protegerInicio, Math.floor(r.de)), ate = Math.min(palavras.length - 1, Math.floor(r.ate));
    for (let i = de; i <= ate; i++) tira.add(i);
  }
  if (!tira.size || tira.size > palavras.length * maxFracao) return [];
  const out = [];
  for (const i of [...tira].sort((a, b) => a - b)) {
    const ini = +(palavras[i].start - 0.04).toFixed(2), fim = +((palavras[i + 1]?.start ?? palavras[i].end) - 0.04).toFixed(2);
    const u = out.at(-1);
    if (u && ini - u[1] < 0.1) u[1] = Math.max(u[1], fim); else if (fim > ini) out.push([Math.max(0, ini), fim]);
  }
  return out;
}

const cacheFala = new Map();
export async function revisarFala(palavras, { client = null } = {}) {
  if (!palavras || palavras.length < 12) return [];
  const chave = palavras.map((w) => `${w.text}@${w.start}`).join('|');
  if (cacheFala.has(chave)) return cacheFala.get(chave);
  let ia = client;
  try { ia ||= clienteIa(); } catch { return []; }
  try {
    const msg = await ia.messages.create({
      model: MODELO, max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_FALA } },
      system: SISTEMA_FALA,
      messages: [{ role: 'user', content: montarFala(palavras) }],
    });
    if (msg.stop_reason === 'refusal') return [];
    const r = aplicarRevisaoFala(palavras, JSON.parse(msg.content.find((b) => b.type === 'text')?.text || '{}').remover);
    cacheFala.set(chave, r);
    return r;
  } catch { return []; }
}
