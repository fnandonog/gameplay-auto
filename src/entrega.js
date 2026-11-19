// Delivery to the owner's own posting skill: approved cuts are copied, one folder each, to config.pastaEntrega
// (default ~/Gameplay/prontos/<line>/<date>_<session>_<nn>/) with the video, the cover, post.json and legenda.txt.
// The skill reads the folders and posts; this platform only makes the cuts. Upload-Post stays as the other option
// (config.postagem: 'upload-post').
import fs from 'node:fs';
import path from 'node:path';
import { listarSessoes } from './painel.js';
import { linhasDe, linhaDoCorte, distribuirLinhas, horariosSeguros } from './canais.js';
import { autoAprovar, textos, proximoHorario } from './postagem.js';
import { registrar } from './atividade.js';
import { lerPausa } from './qualidade.js';

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

// what goes in post.json (pure)
// slots already given to delivered posts of a line (their agendarPara), so the next cut takes the next free one
function slotsDaLinha(base, linhaId) {
  const dir = path.join(base, slug(linhaId || 'geral'));
  let ds = []; try { ds = fs.readdirSync(dir); } catch {}
  return ds.map((d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, d, 'post.json'), 'utf8')).agendarPara; } catch { return null; } }).filter(Boolean);
}

export function postDoCorte(c, { sessao, linha, duracao, agendarPara = null } = {}) {
  const t = textos(c);
  return {
    titulo: c.titulo || '', descricao: c.descricao || '', hashtags: c.hashtags || [], gancho: c.gancho || '',
    legendas: { tiktok: t.legenda, instagram: t.legenda, facebook: t.legenda, youtube: { titulo: t.tituloYoutube, descricao: t.descricaoYoutube } },
    linha: linha ? { id: linha.id, nome: linha.nome, perfil: linha.perfil, redes: linha.redes, horarios: linha.horarios } : null,
    arroba: c.arroba || linha?.arroba || '', formato: c.formato || null, outrosFormatos: Object.keys(c.variantes || {}).filter((f) => f !== c.formato),
    nota: c.nota ?? null, duracao: duracao ?? (c.fim != null && c.inicio != null ? +(c.fim - c.inicio).toFixed(2) : null),
    credito: c.credito || null, aviso: c.aviso || null, sessao, criadoEm: new Date().toISOString(),
    // when the posting skill should publish it: the line's next free peak hour, within the safe daily limit
    agendarPara,
  };
}

// post.json of a long video: YouTube only, title ≤100, description with the chapters (pure)
export function postDoLongo(v, { sessao, agendarPara = null } = {}) {
  return {
    tipo: v.missao ? 'missao' : 'longo', missao: v.missao || null, titulo: String(v.titulo || '').slice(0, 100), descricao: String(v.descricao || '').slice(0, 4900),
    hashtags: v.tags || v.hashtags || [], legendas: { youtube: { titulo: String(v.titulo || '').slice(0, 100), descricao: String(v.descricao || '').slice(0, 4900) } },
    linha: { id: 'youtube-longo', nome: 'YouTube (vídeo longo)', redes: ['youtube'] }, formato: 'horizontal',
    duracao: v.duracao ?? null, aviso: v.aviso || null, sessao, criadoEm: new Date().toISOString(), agendarPara,
  };
}

export const pastaDoCorte = (base, { linha, sessao, arquivo }) =>
  path.join(base, slug(linha?.id || 'geral'), `${slug(sessao).slice(0, 30)}_${slug(arquivo.replace(/\.mp4$/, '')).slice(0, 40)}`);

// Copies every approved cut (and, with postarAutomatico, the ones that pass the quality gate). Returns how many.
export function entregarAprovados(config, { log = console.log } = {}) {
  const base = config.pastaEntrega;
  if (!base) return 0;
  if (lerPausa(config.pastaSaida)) return 0;
  const linhas = linhasDe(config);
  let n = 0;
  for (const s of listarSessoes(config.pastaSaida)) {
    const { pasta, ...dados } = s;
    const file = path.join(config.pastaSaida, pasta, 'sessao.json');
    const antes = JSON.stringify(dados.cortes.map((c) => [c.linha, c.status]));
    distribuirLinhas(dados.cortes, linhas);
    if (config.postarAutomatico) autoAprovar(dados.cortes, config, linhas, pasta);
    let mudou = JSON.stringify(dados.cortes.map((c) => [c.linha, c.status])) !== antes;
    for (const c of dados.cortes.filter((x) => x.status === 'aprovado')) {
      const linha = linhaDoCorte(c, linhas);
      const destino = pastaDoCorte(base, { linha, sessao: dados.sessao || pasta, arquivo: c.arquivo });
      try {
        fs.mkdirSync(destino, { recursive: true });
        fs.copyFileSync(path.join(config.pastaSaida, pasta, c.arquivo), path.join(destino, 'video.mp4'));
        if (c.capa && fs.existsSync(path.join(config.pastaSaida, pasta, c.capa))) fs.copyFileSync(path.join(config.pastaSaida, pasta, c.capa), path.join(destino, 'capa.jpg'));
        let agendarPara = null;
        try { agendarPara = proximoHorario(Date.now(), horariosSeguros(linha, config.limites), slotsDaLinha(base, linha.id)); } catch {}
        const post = postDoCorte(c, { sessao: dados.sessao || pasta, linha, agendarPara });
        fs.writeFileSync(path.join(destino, 'legenda.txt'), `${post.legendas.tiktok}\n`);
        // post.json last: the skill may take a folder as ready once it exists
        fs.writeFileSync(path.join(destino, 'post.json'), JSON.stringify(post, null, 2));
        c.status = 'entregue'; c.entregueEm = post.criadoEm; c.agendadoPara = agendarPara; c.pastaEntrega = destino; c.linha = linha.id; delete c.erroEntrega;
        registrar(config.pastaSaida, 'agendador', 'trabalhando', `Entregue "${c.titulo}" para ${linha.nome}`);
        log(`Entregue: ${c.titulo} → ${destino}`); n++;
      } catch (e) { c.erroEntrega = e.message; log(`Não entregou "${c.titulo}": ${e.message}`); }
      mudou = true;
    }
    // long YouTube videos (the whole session and one per mission): prontos/youtube-longo/<sessão>_<vídeo>/
    for (const v of [dados.longo, ...(dados.missoes || [])].filter((x) => x?.status === 'aprovado')) {
      const destino = pastaDoCorte(base, { linha: { id: 'youtube-longo' }, sessao: dados.sessao || pasta, arquivo: path.basename(v.arquivo) });
      try {
        fs.mkdirSync(destino, { recursive: true });
        fs.copyFileSync(path.join(config.pastaSaida, pasta, v.arquivo), path.join(destino, 'video.mp4'));
        if (v.thumb && fs.existsSync(path.join(config.pastaSaida, pasta, v.thumb))) fs.copyFileSync(path.join(config.pastaSaida, pasta, v.thumb), path.join(destino, 'capa.jpg'));
        let agendarPara = null;
        try { agendarPara = proximoHorario(Date.now(), config.longo?.horarios || ['19:00'], slotsDaLinha(base, 'youtube-longo')); } catch {}
        const post = postDoLongo(v, { sessao: dados.sessao || pasta, agendarPara });
        fs.writeFileSync(path.join(destino, 'post.json'), JSON.stringify(post, null, 2));
        v.status = 'entregue'; v.entregueEm = post.criadoEm; v.agendadoPara = agendarPara; v.pastaEntrega = destino; delete v.erroEntrega;
        registrar(config.pastaSaida, 'agendador', 'trabalhando', `Entregue o vídeo longo "${v.titulo}"`);
        log(`Entregue: ${v.titulo} → ${destino}`); n++;
      } catch (e) { v.erroEntrega = e.message; log(`Não entregou "${v.titulo}": ${e.message}`); }
      mudou = true;
    }
    if (mudou) fs.writeFileSync(file, JSON.stringify(dados, null, 2));
  }
  if (n) registrar(config.pastaSaida, 'agendador', 'pronto', `${n} corte(s) entregue(s) para a postagem`);
  return n;
}
