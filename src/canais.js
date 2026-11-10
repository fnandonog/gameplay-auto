// Channel lines. A "linha" is one Upload-Post profile (one TikTok, one Instagram and/or one YouTube account) with its own
// content angle and peak hours. Every cut goes to exactly ONE line, so no account of ours reposts what another one already
// posted (TikTok and YouTube push duplicates down and can flag the accounts as unoriginal/inauthentic).
// The long video goes to the main YouTube channel (config.longo.perfil).

// Suggested map for FNANDO + CLIPAÍ (see docs/operacao.md). Profiles must exist in Upload-Post with these names.
export const LINHAS_SUGERIDAS = [
  { id: 'principal', nome: 'FNANDO', perfil: 'fnando', redes: ['tiktok', 'instagram'], automatico: true,
    conteudo: 'Os melhores momentos da live, com fala e reação', horarios: ['12:00', '18:30', '21:00'] },
  { id: 'shorts', nome: 'FNANDO Shorts', perfil: 'fnando-shorts', redes: ['youtube', 'tiktok', 'instagram'], automatico: true,
    conteudo: 'Lances: gols, dribles, viradas e finais de partida', horarios: ['11:30', '17:30', '20:30'] },
  { id: 'resenha', nome: 'FNANDO Resenha', perfil: 'fnando-resenha', redes: ['tiktok', 'instagram'], automatico: true,
    conteudo: 'Raiva, zoeira e reações engraçadas', horarios: ['13:00', '19:30', '22:30'] },
  { id: 'dicas', nome: 'FNANDO Dicas', perfil: 'fnando-dicas', redes: ['youtube', 'tiktok'], automatico: false,
    conteudo: 'Tutoriais e dicas do jogo (gravados de propósito, não saem da live)', horarios: ['10:00', '16:00'] },
  { id: 'clipai', nome: 'CLIPAÍ', perfil: 'clipai', redes: ['youtube', 'tiktok', 'instagram'], automatico: false, terceiros: true,
    conteudo: 'Cortes de streamers que autorizaram por escrito', horarios: ['12:30', '19:00', '21:30'] },
];

// The lines in use. Without config.linhas it is one line built from config.uploadPost (the original single-profile setup).
export function linhasDe(config) {
  if (Array.isArray(config.linhas) && config.linhas.length) return config.linhas;
  const up = config.uploadPost || {};
  return [{ id: 'principal', nome: config.canal || 'Principal', perfil: up.perfil || '', redes: up.redes || ['tiktok', 'instagram', 'youtube'],
    horarios: up.horarios || ['12:00', '18:30', '21:00'], automatico: true }];
}

// Our own cuts are spread over the automatic lines that are not third-party: the best one goes to the first line,
// the next to the second and so on, round robin. A cut that already has a valid line keeps it (the owner may have changed it).
export function distribuirLinhas(cortes, linhas) {
  const auto = linhas.filter((l) => l.automatico !== false && !l.terceiros);
  if (!auto.length) return cortes;
  const ids = new Set(linhas.map((l) => l.id));
  let i = 0;
  for (const c of [...cortes].sort((a, b) => (b.nota || 0) - (a.nota || 0))) {
    if (c.linha && ids.has(c.linha)) continue;
    c.linha = auto[i++ % auto.length].id;
  }
  return cortes;
}

export const linhaDoCorte = (c, linhas) => linhas.find((l) => l.id === c.linha) || linhas.find((l) => !l.terceiros) || linhas[0];
