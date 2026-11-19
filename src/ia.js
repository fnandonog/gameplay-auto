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
