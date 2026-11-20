// YouTube through the owner's Chrome (YouTube Studio), for what the API quota does not cover: the API sends the best
// cuts of the day (selecaoApiYoutube in src/postador.js) and the same FNANDO extension (extensao-tiktok/) posts the rest
// through studio.youtube.com, where the channel is logged in. Same code and routes family as src/tiktokChrome.js.
// State per post folder: .youtube-chrome.json { em, tentativas, postou, erro }; success goes to postado.json links.youtube
// and emRede['youtube-chrome'] (so it does not use up the API count of the day).
import fs from 'node:fs';
import path from 'node:path';
import { listarEntregues, selecaoApiYoutube } from './postador.js';
import { metadadosYoutube } from './postadores/youtube.js';
import { assinar, partesDoId } from './tiktokChrome.js';

export const ESPERA_MS = 20 * 60000;
export const MAX_TENTATIVAS = 2;
const ESTADO = '.youtube-chrome.json';
const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const dia = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// pure: may this post go to the extension now?
export function disponivelYt(p, agora, apiIds) {
  const { post, postado, ytChrome: e } = p;
  if (post.aviso || !(post.linha?.redes || []).includes('youtube')) return false;
  if (postado.links?.youtube) return false;
  if (post.agendarPara && Date.parse(post.agendarPara) > agora) return false;
  if (apiIds.has(p.id)) return false; // the API sends this one
  const t = p.estado.youtube?.tentativas || 0;
  if (t > 0 && t < 3) return false; // the API is on it (retrying)
  if (e?.postou || e?.rascunho || (e?.tentativas || 0) >= MAX_TENTATIVAS) return false;
  if (e?.em && agora - Date.parse(e.em) < ESPERA_MS) return false;
  return true;
}

// The next post for YouTube Studio, or null. apiLimite = what the API may still send today (0 when not connected).
// YouTube's daily upload limit (unverified channels): no new tries for 24 h, kept in <base>/.youtube-limite.json
const LIMITE = '.youtube-limite.json';
export const limiteAtivo = (base, agora = Date.now()) => { const l = ler(path.join(base, LIMITE)); return !!(l?.ate && Date.parse(l.ate) > agora); };

// intervaloMin: minutes between two YouTube uploads (the owner asked for one per hour; 0 = one after the other)
export function proximoJobYoutube({ base, token, agora = Date.now(), pausa = null, apiLimite = 0, limite = 30, intervaloMin = 0 }) {
  if (pausa || limiteAtivo(base, agora)) return null;
  const posts = listarEntregues(base);
  if (intervaloMin > 0) {
    const ultimo = Math.max(0, ...posts.map((p) => Math.max(Date.parse(p.postado.emRede?.['youtube-chrome'] || 0) || 0, Date.parse(p.ytChrome?.em || 0) || 0)));
    if (agora - ultimo < intervaloMin * 60000) return null;
  }
  const hoje = posts.filter((p) => p.postado.emRede?.['youtube-chrome'] && dia(Date.parse(p.postado.emRede['youtube-chrome'])) === dia(agora)).length;
  if (hoje >= limite) return null;
  const api = new Set(apiLimite > 0 ? selecaoApiYoutube(posts, agora, apiLimite).map((p) => p.id) : []);
  const fila = posts.filter((p) => disponivelYt(p, agora, api))
    .sort((a, b) => (b.post.postarJa ? 1 : 0) - (a.post.postarJa ? 1 : 0) || String(a.post.agendarPara || a.post.criadoEm || '').localeCompare(String(b.post.agendarPara || b.post.criadoEm || '')));
  const p = fila[0];
  if (!p) return null;
  fs.writeFileSync(path.join(p.dir, ESTADO), JSON.stringify({ ...(p.ytChrome || {}), em: new Date(agora).toISOString(), tentativas: (p.ytChrome?.tentativas || 0) + 1 }, null, 2));
  const m = metadadosYoutube(p.post);
  const temCapa = fs.existsSync(path.join(p.dir, 'capa.jpg'));
  return {
    id: p.id,
    rede: 'youtube',
    video: `/api/tiktok-chrome/video/${encodeURIComponent(p.id)}?t=${assinar(token, p.id)}`,
    capa: temCapa ? `/api/tiktok-chrome/capa/${encodeURIComponent(p.id)}?t=${assinar(token, p.id)}` : null,
    titulo: m.snippet.title,
    descricao: [m.snippet.description, m.snippet.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')].filter(Boolean).join('\n\n').slice(0, 4900),
    longo: p.post.tipo === 'longo' || p.post.tipo === 'missao',
  };
}

export function arquivoDaCapa(base, id) {
  const p = partesDoId(id);
  if (!p) return null;
  const f = path.join(base, p.linha, p.pasta, 'capa.jpg');
  return fs.existsSync(f) ? f : null;
}

export function registrarResultadoYoutube(base, { id, ok, link, erro, etapa, postou } = {}, agora = Date.now()) {
  const p = partesDoId(id);
  const dir = p && path.join(base, p.linha, p.pasta);
  if (!dir || !fs.existsSync(path.join(dir, 'post.json'))) throw new Error('Post não encontrado.');
  const em = new Date(agora).toISOString();
  const estado = ler(path.join(dir, ESTADO)) || {};
  if (ok) {
    const antes = ler(path.join(dir, 'postado.json')) || {};
    const postado = { ...antes, em: antes.em || em, links: { ...(antes.links || {}), youtube: typeof link === 'string' && /^https:\/\/(www\.)?(youtu\.be|youtube\.com)\//.test(link) ? link : 'publicado' }, emRede: { ...(antes.emRede || {}), 'youtube-chrome': em } };
    fs.writeFileSync(path.join(dir, 'postado.json'), JSON.stringify(postado, null, 2));
    fs.writeFileSync(path.join(dir, ESTADO), JSON.stringify({ ...estado, em, postou: true, ok: true, erro: null }, null, 2));
    return { ok: true, postado };
  }
  // once the video was attached, YouTube keeps it as a draft: a retry would make a second draft, so it stops here
  // the daily upload limit stops the upload before YouTube keeps anything: no draft, and the try does not count
  const antesDoAnexo = /^(abrir|anexar)/.test(String(etapa || ''));
  const limite = /limite di[aá]rio|daily upload limit/i.test(String(erro || ''));
  if (limite) fs.writeFileSync(path.join(base, LIMITE), JSON.stringify({ em, ate: new Date(agora + 24 * 3600000).toISOString(), erro: String(erro).slice(0, 200) }, null, 2));
  const novo = { ...estado, em, ok: false, rascunho: (!antesDoAnexo && !limite) || !!estado.rascunho, ...(limite ? { tentativas: Math.max(0, (estado.tentativas || 1) - 1) } : {}), postou: !!postou || !!estado.postou, erro: String(erro || 'sem detalhe').slice(0, 300), etapa: etapa ? String(etapa).slice(0, 80) : null };
  fs.writeFileSync(path.join(dir, ESTADO), JSON.stringify(novo, null, 2));
  return { ok: false, estado: novo };
}
