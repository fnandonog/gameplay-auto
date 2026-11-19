// TikTok through the owner's Chrome: the "FNANDO: TikTok pelo Chrome" extension (extensao-tiktok/) asks this panel every
// 2 minutes for the next delivered cut of a line that posts on TikTok, publishes it through TikTok Studio in the Chrome
// where the account is logged in, and reports back. No TikTok API and no paid service.
// The extension authenticates with a code kept in ~/Gameplay/.tiktok-chrome-token (created on the first panel start,
// shown only on this Mac in the Contas tab). The video link carries a per-post signature instead of the code, because
// the download runs inside the TikTok Studio page.
// State per post folder: .tiktok-chrome.json { em, tentativas, postou, erro }; success goes to postado.json links.tiktok.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LIMITES_SEGUROS } from './canais.js';

export const ESPERA_MS = 15 * 60000; // a post handed out (or that failed) is not handed out again for 15 min
export const MAX_TENTATIVAS = 2; // stopped before clicking Publish: one more try, then the owner looks
const ESTADO = '.tiktok-chrome.json';

export const arquivoToken = (config = {}) => config.arquivoTokenTiktok || path.join(os.homedir(), 'Gameplay', '.tiktok-chrome-token');

// reads the code, creating it (owner-only file) the first time
export function garantirToken(file) {
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (t.length >= 32) return t; } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  return t;
}

const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// pure: "Authorization: Bearer <code>" matches
export const bearerOk = (header, token) => !!token && igual(String(header || '').replace(/^Bearer\s+/i, ''), token);
// pure: the signature that lets one video be downloaded without the code
export const assinar = (token, id) => crypto.createHmac('sha256', token).update(String(id)).digest('hex').slice(0, 32);
export const assinaturaOk = (token, id, sig) => !!sig && igual(sig, assinar(token, id));

const nome = (s) => typeof s === 'string' && s.length > 0 && s === path.basename(s) && !s.startsWith('.');
// pure: "<linha>/<pasta>" → its parts, or null when it is not two plain folder names
export function partesDoId(id) {
  const p = String(id || '').split('/');
  return p.length === 2 && p.every(nome) ? { linha: p[0], pasta: p[1] } : null;
}

// pure: what is typed in the TikTok caption. The delivered caption already has title, description, credit and hashtags;
// older post.json files without it get title (or hook) + description + hashtags.
export function legendaTikTok(post) {
  const pronta = post?.legendas?.tiktok;
  if (typeof pronta === 'string' && pronta.trim()) return pronta.slice(0, 2200);
  const tags = (post?.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ');
  return [post?.titulo || post?.gancho, post?.descricao, tags].filter((x) => String(x || '').trim()).join('\n\n').slice(0, 2200);
}

const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// every delivered post of a TikTok line with its state
export function postsTikTok(base) {
  const out = [];
  let linhas = []; try { linhas = fs.readdirSync(base).filter(nome); } catch {}
  for (const linha of linhas) {
    let pastas = []; try { pastas = fs.readdirSync(path.join(base, linha)).filter(nome); } catch {}
    for (const pasta of pastas) {
      const dir = path.join(base, linha, pasta);
      const post = ler(path.join(dir, 'post.json'));
      if (!post || !(post.linha?.redes || []).includes('tiktok')) continue;
      out.push({ id: `${linha}/${pasta}`, dir, post, postado: ler(path.join(dir, 'postado.json')), estado: ler(path.join(dir, ESTADO)) });
    }
  }
  return out;
}

// pure: may this post go to the extension now?
export function disponivel({ post, postado, estado }, agora) {
  if (post.aviso) return false; // nudity/gore on screen: never on its own
  if (postado?.links?.tiktok || post.postadoEm) return false;
  if (post.agendarPara && Date.parse(post.agendarPara) > agora) return false;
  if (estado?.postou || (estado?.tentativas || 0) >= MAX_TENTATIVAS) return false;
  if (estado?.em && agora - Date.parse(estado.em) < ESPERA_MS) return false;
  return true;
}

// The next post for the extension (oldest due first), or null. Paused = null. Marks it as handed out.
const dia = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export function proximoJob({ base, token, agora = Date.now(), pausa = null, limite = LIMITES_SEGUROS.tiktok }) {
  if (pausa) return null;
  const todos = postsTikTok(base);
  const hoje = todos.filter((p) => p.postado?.emRede?.tiktok && dia(Date.parse(p.postado.emRede.tiktok)) === dia(agora)).length;
  if (hoje >= limite) return null; // safe daily limit per account
  const fila = todos
    .filter((p) => disponivel(p, agora) && fs.existsSync(path.join(p.dir, 'video.mp4')))
    .sort((a, b) => String(a.post.agendarPara || a.post.criadoEm || '').localeCompare(String(b.post.agendarPara || b.post.criadoEm || '')));
  const p = fila[0];
  if (!p) return null;
  fs.writeFileSync(path.join(p.dir, ESTADO), JSON.stringify({ ...(p.estado || {}), em: new Date(agora).toISOString(), tentativas: (p.estado?.tentativas || 0) + 1 }, null, 2));
  return {
    id: p.id,
    video: `/api/tiktok-chrome/video/${encodeURIComponent(p.id)}?t=${assinar(token, p.id)}`,
    legenda: legendaTikTok(p.post),
    titulo: p.post.titulo || '',
  };
}

// the mp4 of a post, or null (only video.mp4 inside a delivered folder)
export function arquivoDoVideo(base, id) {
  const p = partesDoId(id);
  if (!p) return null;
  const f = path.join(base, p.linha, p.pasta, 'video.mp4');
  return fs.existsSync(f) ? f : null;
}

// What the extension reports. ok: postado.json gets links.tiktok (other networks' links stay). Not ok: the error is
// kept; with postou (it clicked Publish) it is never handed out again, the owner checks the profile.
export function registrarResultado(base, { id, ok, link, erro, etapa, postou } = {}, agora = Date.now()) {
  const p = partesDoId(id);
  const dir = p && path.join(base, p.linha, p.pasta);
  if (!dir || !fs.existsSync(path.join(dir, 'post.json'))) throw new Error('Post não encontrado.');
  const em = new Date(agora).toISOString();
  const estado = ler(path.join(dir, ESTADO)) || {};
  if (ok) {
    const antes = ler(path.join(dir, 'postado.json')) || {};
    const postado = { ...antes, em: antes.em || em, links: { ...(antes.links || {}), tiktok: typeof link === 'string' && /^https:\/\//.test(link) ? link : 'publicado' }, emRede: { ...(antes.emRede || {}), tiktok: em } };
    fs.writeFileSync(path.join(dir, 'postado.json'), JSON.stringify(postado, null, 2));
    fs.writeFileSync(path.join(dir, ESTADO), JSON.stringify({ ...estado, em, postou: true, ok: true, erro: null }, null, 2));
    return { ok: true, postado };
  }
  const novo = { ...estado, em, ok: false, postou: !!postou || !!estado.postou, erro: String(erro || 'sem detalhe').slice(0, 300), etapa: etapa ? String(etapa).slice(0, 80) : null };
  fs.writeFileSync(path.join(dir, ESTADO), JSON.stringify(novo, null, 2));
  return { ok: false, estado: novo };
}
