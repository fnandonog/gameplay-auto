// Stretches the owner asks to become a cut no matter what (e.g. the PS5 he found inside the game), by recording
// name and time: ~/Gameplay/trechos-fixos.json [{ gravacao: '2026-11-19 09-35-27', de: '29:15', ate: '30:05', gancho, titulo }].
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const arquivoTrechos = (config = {}) => config.arquivoTrechos || path.join(os.homedir(), 'Gameplay', 'trechos-fixos.json');

export function lerTrechos(config) {
  try { const j = JSON.parse(fs.readFileSync(arquivoTrechos(config), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}

// "29:15" | "1:02:03" | 1755 → seconds
export function seg(v) {
  if (typeof v === 'number') return v;
  const p = String(v || '').trim().split(':').map(Number);
  if (!p.length || p.some((n) => !Number.isFinite(n))) return NaN;
  return p.reduce((t, n) => t * 60 + n, 0);
}

const chave = (s) => String(s || '').replace(/[^\d]/g, '');

// pure: the candidates of one recording (matched by the digits of its name, so "2026-11-19 09-35-27.mkv" fits)
export function trechosDaGravacao(trechos, base, duracao = Infinity) {
  const k = chave(base);
  return trechos.filter((t) => k && chave(t.gravacao) && k.includes(chave(t.gravacao)))
    .map((t) => ({ start: Math.max(0, seg(t.de)), end: Math.min(duracao || Infinity, seg(t.ate)), nota: 10, fixo: true, obrigatorio: true, motivo: `pedido pelo dono${t.motivo ? `: ${t.motivo}` : ''}`, gancho: t.gancho, titulo: t.titulo }))
    .filter((c) => c.end - c.start >= 5);
}
