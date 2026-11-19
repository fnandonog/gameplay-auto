// Series ("Coisas que dá pra fazer no GTA 6 - Parte 3"): people who liked part 2 look for part 3, and the profile
// fills with a recognizable format. The AI names the series of a cut; here each series gets its next number.
// The counters live in <pastaSaida>/.series.json.
import fs from 'node:fs';
import path from 'node:path';

const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// pure: numbers the cuts that have a series, best score first; returns the new counters
export function numerarSeries(cortes, contadores = {}) {
  const out = { ...contadores };
  for (const c of [...cortes].sort((a, b) => (b.nota || 0) - (a.nota || 0))) {
    const k = chave(c.serie);
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
    c.parte = out[k];
    if (!/parte \d+/i.test(c.titulo || '')) c.titulo = `${String(c.titulo || '').trim()} (Parte ${c.parte})`.trim();
    if (c.descricao && !c.descricao.includes(c.serie)) c.descricao = `${c.descricao}\n\nSérie: ${c.serie}, parte ${c.parte}.`;
  }
  return out;
}

export function aplicarSeries(pastaSaida, cortes) {
  const file = path.join(pastaSaida, '.series.json');
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const novo = numerarSeries(cortes, atual);
  if (JSON.stringify(novo) !== JSON.stringify(atual)) { fs.mkdirSync(pastaSaida, { recursive: true }); fs.writeFileSync(file, JSON.stringify(novo, null, 2)); }
  return cortes;
}
