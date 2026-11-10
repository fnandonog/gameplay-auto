// What each "agent" of the pipeline is doing right now, for the pixel art office (/escritorio).
// Every step of the pipeline calls registrar(); the state lives in <pastaSaida>/.escritorio.json
// (current state per agent + the last events). Writing it never breaks the pipeline.
import fs from 'node:fs';
import path from 'node:path';

// The office cast. `mesa` is the desk position in the office grid (column, row); colors are only visual.
export const ELENCO = [
  { id: 'vigia', curto: 'Vigia', nome: 'Vigia', papel: 'Olha a pasta do OBS e pega cada gravação nova', mesa: [0, 0], cor: '#3b82f6', cabelo: '#1b1b1b', pele: '#c68a5e' },
  { id: 'escriba', curto: 'Escriba', nome: 'Escriba', papel: 'Transcreve sua fala (whisper, no Mac)', mesa: [1, 0], cor: '#14b8a6', cabelo: '#6b3a1e', pele: '#f1c9a5' },
  { id: 'cacador', curto: 'Caçador', nome: 'Caçador de lances', papel: 'Acha os momentos: "clipa isso", marcadores, gritos e gols', mesa: [2, 0], cor: '#f59e0b', cabelo: '#d8a24a', pele: '#f3d2b5' },
  { id: 'roteirista', curto: 'Roteirista', nome: 'Roteirista IA', papel: 'Escolhe o corte exato, o gancho, o título e as hashtags', mesa: [3, 0], cor: '#a855f7', cabelo: '#2a1a3a', pele: '#8d5a3b' },
  { id: 'editor', curto: 'Editor', nome: 'Editor', papel: 'Monta o vertical: câmera em cima, jogo embaixo, legenda', mesa: [0, 1], cor: '#ff4f9a', cabelo: '#111111', pele: '#8d5a3b' },
  { id: 'montador', curto: 'Montador', nome: 'Montador do longo', papel: 'Monta o vídeo do YouTube com capítulos e thumbnail', mesa: [1, 1], cor: '#ef4444', cabelo: '#4a4a4a', pele: '#e8b48f' },
  { id: 'revisor', curto: 'Você', nome: 'Você (aprovação)', papel: 'Aprova ou descarta no celular', mesa: [2, 1], cor: '#FFE600', cabelo: '#1b1b1b', pele: '#d9a47c', dono: true },
  { id: 'agendador', curto: 'Agendador', nome: 'Agendador', papel: 'Agenda cada corte na linha certa (Upload-Post)', mesa: [3, 1], cor: '#22c55e', cabelo: '#3c2416', pele: '#c68a5e' },
  { id: 'clipador', curto: 'Clipador', nome: 'Clipador CLIPAÍ', papel: 'Corta lives de streamers que autorizaram por escrito', mesa: [0, 2], cor: '#00E0FF', cabelo: '#e2c26b', pele: '#f2cfb0' },
  { id: 'analista', curto: 'Analista', nome: 'Analista', papel: 'Lê as métricas e diz o que reeditar (em breve)', mesa: [1, 2], cor: '#94a3b8', cabelo: '#7a1f1f', pele: '#f6d7bd' },
];

export const ESTADOS = ['parado', 'trabalhando', 'pronto', 'esperando', 'erro'];
const MAX_EVENTOS = 120;
const TRAVADO_MS = 3 * 3600000; // "working" for more than this means the process died

export const arquivoAtividade = (pastaSaida) => path.join(pastaSaida, '.escritorio.json');

// pure: applies one event to the state
export function aplicarEvento(estado, { agente, estado: st, texto = '', em }) {
  const out = { agentes: { ...(estado?.agentes || {}) }, eventos: [...(estado?.eventos || [])] };
  if (!ELENCO.some((a) => a.id === agente) || !ESTADOS.includes(st)) return out;
  out.agentes[agente] = { estado: st, texto: String(texto).slice(0, 200), em };
  out.eventos.push({ agente, estado: st, texto: String(texto).slice(0, 200), em });
  if (out.eventos.length > MAX_EVENTOS) out.eventos = out.eventos.slice(-MAX_EVENTOS);
  return out;
}

export function lerAtividade(pastaSaida) {
  try { return JSON.parse(fs.readFileSync(arquivoAtividade(pastaSaida), 'utf8')); } catch { return { agentes: {}, eventos: [] }; }
}

export function registrar(pastaSaida, agente, estado, texto, em = new Date().toISOString()) {
  if (!pastaSaida) return;
  try {
    fs.mkdirSync(pastaSaida, { recursive: true });
    const file = arquivoAtividade(pastaSaida);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(aplicarEvento(lerAtividade(pastaSaida), { agente, estado, texto, em })));
    fs.renameSync(tmp, file);
  } catch { /* the office is only a view; never stop the pipeline for it */ }
}

// pure: what the office shows. sessoes = listarSessoes(); linhas = the channel lines.
export function quadroEscritorio({ atividade, sessoes = [], linhas = [], agora = Date.now(), config = {}, pausa = null }) {
  const cortes = sessoes.flatMap((s) => s.cortes || []);
  const conta = (st) => cortes.filter((c) => c.status === st).length;
  const agentes = ELENCO.map((a) => {
    let at = atividade?.agentes?.[a.id] || { estado: 'parado', texto: '' };
    if (at.estado === 'trabalhando' && at.em && agora - Date.parse(at.em) > TRAVADO_MS) at = { ...at, estado: 'parado', texto: `${at.texto} (parou sem terminar)` };
    if (a.id === 'agendador' && pausa) at = { estado: 'erro', texto: `Pausado: ${pausa.motivo}`, em: pausa.em };
    if (a.id === 'revisor' && config.postarAutomatico) {
      const n = cortes.filter((c) => c.descartadoPor === 'filtro').length;
      at = { estado: 'pronto', texto: `Piloto automático: o filtro aprova sozinho${n ? ` (${n} corte(s) barrado(s))` : ''}` };
    } else if (a.id === 'revisor') {
      const n = conta('aguardando');
      at = n ? { estado: 'esperando', texto: `${n} corte(s) esperando sua aprovação` } : { estado: 'pronto', texto: 'Nada para aprovar' };
    }
    if (a.id === 'clipador' && !at.em) {
      const fontes = (config.terceiros?.fontes || []).filter((f) => f.permissao);
      at = { estado: 'parado', texto: fontes.length ? `${fontes.length} streamer(s) autorizado(s)` : 'Esperando a primeira permissão de streamer' };
    }
    if (a.id === 'analista' && !at.em) at = { estado: 'parado', texto: 'Liga quando os canais tiverem os primeiros posts' };
    return { ...a, ...at };
  });
  const filas = linhas.map((l) => {
    const daLinha = cortes.filter((c) => c.linha === l.id);
    return { id: l.id, nome: l.nome, redes: l.redes, conteudo: l.conteudo, automatico: l.automatico !== false, terceiros: !!l.terceiros,
      aguardando: daLinha.filter((c) => c.status === 'aguardando' || c.status === 'aprovado').length,
      agendados: daLinha.filter((c) => c.status === 'agendado').length,
      proximo: daLinha.filter((c) => c.agendadoPara && Date.parse(c.agendadoPara) > agora).map((c) => c.agendadoPara).sort()[0] || null };
  });
  return {
    agentes, filas,
    eventos: (atividade?.eventos || []).slice(-30).reverse(),
    totais: { aguardando: conta('aguardando'), aprovados: conta('aprovado'), agendados: conta('agendado'), postados: conta('postado'), sessoes: sessoes.length },
    automatico: !!config.postarAutomatico,
    pausa,
  };
}
