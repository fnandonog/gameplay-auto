// Autopilot: with postarAutomatico on, nobody approves. This is the gate that stands in for the owner,
// and the brake that stops everything when a platform pushes back.
import fs from 'node:fs';
import path from 'node:path';

export const PADRAO_FILTRO = { notaMinima: 8.5, duracaoMin: 12, duracaoMax: 75, errosParaPausar: 3 };

// pure: why a cut may not go out on its own (empty list = it may)
export function motivosRecusa(c, { config = {}, linha = null } = {}) {
  const f = { ...PADRAO_FILTRO, ...(config.filtro || {}) };
  if (config.notaMinima != null && config.filtro?.notaMinima == null) f.notaMinima = config.notaMinima;
  const m = [];
  const dur = Number(c.fim) - Number(c.inicio);
  if (!(Number(c.nota) >= f.notaMinima)) m.push(`nota ${c.nota ?? '?'} abaixo de ${f.notaMinima}`);
  if (Number.isFinite(dur) && (dur < f.duracaoMin || dur > f.duracaoMax)) m.push(`duração ${Math.round(dur)} s fora de ${f.duracaoMin}–${f.duracaoMax} s`);
  if (!String(c.titulo || '').trim()) m.push('sem título');
  if (!String(c.gancho || '').trim()) m.push('sem gancho');
  const terceiro = !!c.credito || !!linha?.terceiros;
  if (terceiro) {
    const fonte = (config.terceiros?.fontes || []).find((x) => x.streamer === c.credito?.streamer);
    if (!c.credito) m.push('corte de terceiro sem crédito');
    else if (!fonte?.permissao) m.push(`${c.credito.streamer} não tem permissão registrada`);
    if (!config.terceiros?.automatico) m.push('CLIPAÍ está em modo manual (terceiros.automatico)');
  }
  return m;
}

// The brake: <pastaSaida>/.pausa.json exists = nothing is posted until the owner resumes on the panel.
const arquivoPausa = (pastaSaida) => path.join(pastaSaida, '.pausa.json');
export function lerPausa(pastaSaida) {
  try { return JSON.parse(fs.readFileSync(arquivoPausa(pastaSaida), 'utf8')); } catch { return null; }
}
export function pausar(pastaSaida, motivo) {
  fs.mkdirSync(pastaSaida, { recursive: true });
  fs.writeFileSync(arquivoPausa(pastaSaida), JSON.stringify({ motivo, em: new Date().toISOString() }));
}
export function retomar(pastaSaida) { fs.rmSync(arquivoPausa(pastaSaida), { force: true }); }

// pure: an error that means "the platform is pushing back", not a network hiccup
export const erroGrave = (msg) => /\b(401|403)\b|banid|banned|suspen|strike|copyright|direitos autorais|policy|violat|blocked|bloquead/i.test(String(msg));
