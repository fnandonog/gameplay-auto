// The channel's brand burned on each cut: the @ handle (small, all the time), the symbol in the corner, the "SEGUE @..."
// card at the end and the color of the progress bar. It comes from the cut's line (src/canais.js), so a FNANDO Resenha
// cut shows @fnandoresenha and a CLIPAÍ cut shows the cyan brand.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MARCAS = {
  fnando: { cor: '#FFE600', logo: path.join(ROOT, 'docs', 'marca', 'fnando-simbolo.png') },
  clipai: { cor: '#00E0FF', logo: path.join(ROOT, 'docs', 'marca', 'clipai-simbolo.png') },
};

// linha: one entry of linhasDe(config); config.marca: { arroba, chamada, logo, mostrarLogo, mostrarArroba } overrides
export function marcaDaLinha(linha = {}, config = {}) {
  const geral = config.marca || {};
  if (geral.mostrarArroba === false && geral.mostrarLogo === false) return null;
  const qual = linha.marca || (linha.terceiros || /clip/i.test(linha.id || '') ? 'clipai' : 'fnando');
  const base = MARCAS[qual] || MARCAS.fnando;
  const arroba = linha.arroba || geral.arroba || '';
  const cor = linha.cor || base.cor;
  return {
    marca: qual,
    arroba: geral.mostrarArroba === false ? '' : (arroba && !arroba.startsWith('@') ? `@${arroba}` : arroba),
    chamada: linha.chamada ?? geral.chamada ?? 'SEGUE',
    logo: geral.mostrarLogo === false ? null : (linha.logo || geral.logo || base.logo),
    cor,
    corBarra: `0x${cor.replace('#', '').toUpperCase()}`,
  };
}
