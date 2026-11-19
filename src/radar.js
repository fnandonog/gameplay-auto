// Radar: trends that blew up abroad (the "Radar da gringa" routine writes them). When one of them shows up in a
// recording (he says its keywords), that window becomes a strong cut candidate with the suggested title.
// No AI here: plain keyword matching on the transcript, so it costs no tokens.
//
// File (radar/radar-gta6.json on the `radar` branch of this repo, copied to config.arquivoRadar):
// { "atualizadoEm": ISO, "jogo": "GTA 6", "itens": [{ "id": "gato-no-carro", "titulo": "Gato no carro roubado",
//   "resumo": "...", "palavras_chave": ["gato", "cat", "carro com gato"],
//   "titulo_short": "NUNCA roube esse carro no GTA 6", "gancho": "...", "confirmado": false, "coberto_no_br": false,
//   "prioridade": 1, "fonte": "https://..." }] }   (palavras_chave mixes words and phrases; the radar thread writes it)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const lerJson = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };

export const arquivoRadar = (config) => config.arquivoRadar || path.join(path.dirname(config.arquivoMetricas || '.'), 'radar', 'tendencias.json');

// the radar thread's format (palavras_chave mixes single words and phrases, titulo_short, prioridade 1 = highest)
export function normalizarItem(i) {
  const chaves = [...(i.palavras || []), ...(i.palavras_chave || [])].map(String);
  return {
    ...i, tituloSugerido: i.tituloSugerido || i.titulo_short || '', prioridade: Number(i.prioridade) || 3,
    palavras: chaves.filter((k) => !norm(k).includes(' ')), frases: [...(i.frases || []), ...chaves.filter((k) => norm(k).includes(' '))],
  };
}

export function lerRadar(config) {
  const r = lerJson(arquivoRadar(config), null);
  const itens = (Array.isArray(r?.itens) ? r.itens : []).filter((i) => i && i.id && i.titulo).map(normalizarItem);
  return { atualizadoEm: r?.atualizadoEm || r?.atualizado_em || null, jogo: r?.jogo || '', itens };
}

// pure: windows where a radar item is talked about. A phrase counts alone; single words need `minPalavras`
// distinct hits within `janela` seconds (one "gato" is chance, "gato" + "carro" + "roubei" is the moment).
export function candidatosDoRadar(words, itens, { janela = 30, minPalavras = 2, antes = 20, depois = 25 } = {}) {
  const ws = words.map((w) => ({ ...w, n: norm(w.word) })).filter((w) => w.n);
  const out = [];
  for (const it0 of itens) {
    const it = it0.frases && it0.palavras && 'prioridade' in it0 ? it0 : normalizarItem(it0);
    const bonus = (it.coberto_no_br ? -1 : 0) + (it.prioridade <= 1 ? 0.5 : 0);
    const hits = [];
    for (const f of it.frases || []) {
      const alvo = norm(f).split(' ').filter(Boolean);
      if (!alvo.length) continue;
      for (let i = 0; i + alvo.length <= ws.length; i++) if (alvo.every((a, k) => ws[i + k].n === a)) hits.push({ t: ws[i].start, forte: true, p: f });
    }
    const chaves = new Set((it.palavras || []).map(norm).filter(Boolean));
    const soltas = ws.filter((w) => chaves.has(w.n)).map((w) => ({ t: w.start, p: w.n }));
    for (const h of soltas) {
      const perto = new Set(soltas.filter((x) => x.t >= h.t && x.t - h.t <= janela).map((x) => x.p));
      if (perto.size >= Math.min(minPalavras, chaves.size)) hits.push({ t: h.t, forte: false, p: [...perto].join(' + ') });
    }
    hits.sort((a, b) => a.t - b.t);
    let ult = -Infinity;
    for (const h of hits) {
      if (h.t - ult < janela * 2) continue; // one window per mention
      ult = h.t;
      out.push({
        start: Math.max(0, h.t - antes), end: h.t + depois, t: h.t, nota: (h.forte ? 9 : 8) + bonus,
        motivo: `radar (bombando lá fora): ${it.titulo}${it.tituloSugerido ? `; título sugerido "${it.tituloSugerido}"` : ''}`,
        radar: it.id,
      });
    }
  }
  return out;
}

// copies the radar file from the `radar` branch (the cloud routine pushes there). Best effort, at most once an hour.
export async function sincronizarRadar(config, { forcar = false } = {}) {
  const f = arquivoRadar(config);
  try { if (!forcar && Date.now() - fs.statSync(f).mtimeMs < 3600e3) return false; } catch {}
  try {
    await run('git', ['-C', ROOT, 'fetch', '-q', 'origin', 'radar'], { timeoutMs: 30000 });
    const txt = await run('git', ['-C', ROOT, 'show', 'origin/radar:radar/radar-gta6.json'], { timeoutMs: 10000 });
    const out = typeof txt === 'string' ? txt : txt?.stdout;
    JSON.parse(out);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, out);
    return true;
  } catch { return false; }
}
