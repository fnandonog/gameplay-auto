// The editor's judgment: Claude reads each candidate's transcript and decides the exact cut, the hook and the titles.
// Without ANTHROPIC_API_KEY (or a profile from `ant auth login`) the pipeline still runs with simple defaults.
import Anthropic from '@anthropic-ai/sdk';
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
        required: ['id', 'usar', 'inicio', 'fim', 'nota', 'gancho', 'titulo', 'descricao', 'hashtags'],
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
- gancho: 2 a 6 palavras em português que aparecem escritas nos 2 primeiros segundos e fazem a pessoa ficar
  (curiosidade ou exagero que o vídeo cumpre; nada de mentira, que derruba a retenção).
- titulo: até 70 caracteres, chamativo, pode ter MAIÚSCULAS em uma ou duas palavras e no máximo 1 emoji.
- descricao: 1 ou 2 frases e uma pergunta para puxar comentário.
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
    if (!c || !d.usar) continue;
    let start = Math.max(c.start, Math.min(d.inicio, c.end - 15));
    let end = Math.min(c.end, Math.max(d.fim, start + 15));
    if (end - start > 75) end = start + 75;
    out.push({ ...c, start, end, nota: d.nota, gancho: d.gancho, titulo: d.titulo, descricao: d.descricao, hashtags: d.hashtags });
  }
  return out;
}

export function semIa(cands) {
  return cands.map((c) => ({ ...c, gancho: c.fixo ? 'OLHA ISSO' : 'NÃO ESPERAVA ESSA', titulo: 'Não acredito no que aconteceu 😱', descricao: 'Você teria feito igual? Comenta aí!', hashtags: ['gameplay', 'ps5', 'gamer'] }));
}

export async function decidirCortes(cands, words, opts = {}) {
  if (!cands.length) return [];
  if (opts.semIa) return semIa(cands);
  let client;
  try { client = new Anthropic(); } catch { return semIa(cands); }
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
