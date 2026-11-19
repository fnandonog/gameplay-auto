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
  if (e?.postou || (e?.tentativas || 0) >= MAX_TENTATIVAS) return false;
  if (e?.em && agora - Date.parse(e.em) < ESPERA_MS) return false;
  return true;
}

// The next post for YouTube Studio, or null. apiLimite = what the API may still send today (0 when not connected).
export function proximoJobYoutube({ base, token, agora = Date.now(), pausa = null, apiLimite = 0, limite = 30 }) {
  if (pausa) return null;
  const posts = listarEntregues(base);
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
  const novo = { ...estado, em, ok: false, postou: !!postou || !!estado.postou, erro: String(erro || 'sem detalhe').slice(0, 300), etapa: etapa ? String(etapa).slice(0, 80) : null };
  fs.writeFileSync(path.join(dir, ESTADO), JSON.stringify(novo, null, 2));
  return { ok: false, estado: novo };
}
