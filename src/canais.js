// Channel lines. A "linha" is one Upload-Post profile (one TikTok, one Instagram and/or one YouTube account) with its own
// content angle and peak hours. Every cut goes to exactly ONE line, so no account of ours reposts what another one already
// posted (TikTok and YouTube push duplicates down and can flag the accounts as unoriginal/inauthentic).
// The long video goes to the main YouTube channel (config.longo.perfil).

// Suggested map for FNANDO + CLIPAÍ (see docs/canais.md). Profiles must exist in Upload-Post with these names.
// A line may set facebookPage (the Page id) when its Upload-Post profile has more than one Facebook Page.
// Posts per day per line = how many horarios it has (one cut per slot), so volume is set here.
export const LINHAS_SUGERIDAS = [
  { id: 'principal', nome: 'FNANDO', perfil: 'fnando', arroba: '@fnando', redes: ['tiktok', 'instagram', 'facebook'], automatico: true,
    conteudo: 'Os melhores momentos da live, com fala e reação', horarios: ['12:00', '18:30', '21:00'] },
  { id: 'shorts', nome: 'FNANDO Shorts', perfil: 'fnando-shorts', arroba: '@fnandoshorts', redes: ['youtube', 'tiktok', 'instagram'], automatico: true,
    conteudo: 'Lances: gols, dribles, viradas e finais de partida', horarios: ['11:30', '17:30', '20:30'] },
  { id: 'resenha', nome: 'FNANDO Resenha', perfil: 'fnando-resenha', arroba: '@fnandoresenha', redes: ['tiktok', 'instagram'], automatico: true,
    conteudo: 'Raiva, zoeira e reações engraçadas', horarios: ['13:00', '19:30', '22:30'] },
  { id: 'dicas', nome: 'FNANDO Dicas', perfil: 'fnando-dicas', arroba: '@fnandodicas', redes: ['youtube', 'tiktok'], automatico: false,
    conteudo: 'Tutoriais e dicas do jogo (gravados de propósito, não saem da live)', horarios: ['10:00', '16:00'] },
  { id: 'clipai', nome: 'CLIPAÍ', perfil: 'clipai', arroba: '@clipai', marca: 'clipai', redes: ['youtube', 'tiktok', 'instagram', 'facebook'], automatico: false, terceiros: true,
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

// Safe volume per account per day. Above this TikTok, Instagram and YouTube treat the account as spam (reach drops to
// zero, "unoriginal content" flags, posting blocks). More volume = more accounts (lines), never more posts per account.
export const LIMITES_SEGUROS = { tiktok: 4, instagram: 3, youtube: 4, facebook: 3 };

// the peak hours a line really uses: no more per day than its strictest network allows (pure)
export function horariosSeguros(linha = {}, limites = {}) {
  const lim = { ...LIMITES_SEGUROS, ...limites };
  const max = Math.min(...(linha.redes || []).map((r) => lim[r] ?? 3), 24);
  return [...(linha.horarios || ['12:00', '18:30', '21:00'])].sort().slice(0, Math.max(1, max));
}

// Automatic pace (config.ritmo.automatico): the owner chose volume. Per network per day up to ritmo.maxPorDia
// (YouTube capped by the API quota: 10,000 units a day, 1,600 per upload = 6 uploads, shorts and long videos together).
export const COTA_YOUTUBE_DIA = 6;
export function limitesDe(config = {}) {
  const r = config.ritmo || {};
  const base = r.automatico ? (() => { const m = Number(r.maxPorDia) || 15; return { tiktok: m, instagram: m, facebook: m, youtube: Math.min(m, COTA_YOUTUBE_DIA) }; })() : {};
  return { ...LIMITES_SEGUROS, ...base, ...(config.limites || {}) };
}
// pure: n times spread evenly between inicio and fim ("HH:MM")
export function gerarHorarios(n, { inicio = '09:00', fim = '23:30' } = {}) {
  const m = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const a = m(inicio), b = m(fim);
  n = Math.max(1, Math.round(n));
  return Array.from({ length: n }, (_, i) => { const t = Math.round(n === 1 ? a : a + (i * (b - a)) / (n - 1)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; });
}
// pure: the times a line uses per day. With the automatic pace it follows the queue: about half of what is waiting
// goes out per day, never fewer than ritmo.minPorDia nor more than the strictest network allows.
export function horariosDoDia(linha = {}, config = {}, naFila = 0) {
  const r = config.ritmo || {};
  if (!r.automatico) return horariosSeguros(linha, limitesDe(config));
  const lim = limitesDe(config);
  const max = Math.min(...(linha.redes || []).filter((x) => x !== 'youtube' || (linha.redes || []).length === 1).map((x) => lim[x] ?? 3), 48);
  const n = Math.min(max, Math.max(Number(r.minPorDia) || 4, Math.ceil(naFila / (Number(r.diasDeFila) || 2))));
  return gerarHorarios(n, { inicio: r.inicio || '09:00', fim: r.fim || '23:30' });
}

// posts per day the whole operation can do safely (pure)
export const capacidadeDiaria = (linhas, limites = {}) => linhas.reduce((n, l) => n + horariosSeguros(l, limites).length, 0);
