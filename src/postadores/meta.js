// Instagram Reels and Facebook Page reels through the official Graph API, uploading the file straight from the Mac
// (resumable upload to rupload.facebook.com), so no public URL is needed. Adapted from unirpdf lib/social/publish.js
// and oauth.js (same flows: container → status polling → publish; Facebook Login → long-lived token → Page token + IG id).
import fs from 'node:fs';

export const GRAPH_VERSION = 'v26.0';
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const RUPLOAD = 'https://rupload.facebook.com';
export const ESCOPOS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// pure: a Graph error as an Error with what the poster needs (grave = the platform is pushing back: pause everything;
// reconectar = the token died: stop this network until the owner reconnects)
export function erroGraph(j, status, rede = 'facebook') {
  const e = (j && j.error) || {};
  const code = Number(e.code), sub = Number(e.error_subcode);
  const msg = e.error_user_msg || e.message || `HTTP ${status}`;
  const nome = rede === 'instagram' ? 'Instagram' : 'Facebook';
  const err = new Error(`${nome}: ${msg}`);
  err.rede = rede;
  if (code === 190 || code === 102) { err.reconectar = true; err.message = `${nome}: o acesso expirou ou foi revogado, conecte de novo na aba Contas. (${msg})`; }
  else if (/API access blocked|restrict|spam|policy|violat|bloque/i.test(msg) || code === 368) err.grave = true;
  else if (code === 10 || (code >= 200 && code < 300)) { err.reconectar = true; err.message = `${nome}: falta permissão para publicar (${msg}). Conecte de novo e aceite todas.`; }
  else if ([4, 17, 32, 613].includes(code) || sub === 2207042) err.adiar = 3600000;
  return err;
}

export async function graph(method, caminho, params = {}, { rede = 'facebook', fetchFn = fetch } = {}) {
  const url = new URL(GRAPH + caminho);
  let body;
  if (method === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  else body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const r = await fetchFn(url, { method, body, signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw erroGraph(j, r.status, rede);
  return j;
}

// pure: the caption for each network (the delivered post.json already has it)
export function legendaMeta(post, rede) {
  const pronta = post?.legendas?.[rede];
  if (typeof pronta === 'string' && pronta.trim()) return pronta.slice(0, 2200);
  const tags = (post?.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ');
  return [post?.titulo, post?.descricao, tags].filter((x) => String(x || '').trim()).join('\n\n').slice(0, 2200);
}

async function enviarBinario(url, token, arquivo, fetchFn) {
  const dados = fs.readFileSync(arquivo);
  const r = await fetchFn(url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(dados.length), 'content-type': 'application/octet-stream' }, body: dados, signal: AbortSignal.timeout(30 * 60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.success === false) throw erroGraph(j.error ? j : { error: { message: j.debug_info?.message || `envio do vídeo falhou (HTTP ${r.status})` } }, r.status);
  return j;
}

export async function publicarInstagram({ igUserId, token, arquivo, legenda }, { fetchFn = fetch, pausaMs = 5000, maxMs = 15 * 60000 } = {}) {
  const op = { rede: 'instagram', fetchFn };
  const c = await graph('POST', `/${igUserId}/media`, { media_type: 'REELS', upload_type: 'resumable', caption: legenda, share_to_feed: 'true', access_token: token }, op);
  await enviarBinario(c.uri || `${RUPLOAD}/ig-api-upload/${GRAPH_VERSION}/${c.id}`, token, arquivo, fetchFn);
  const t0 = Date.now();
  for (;;) {
    const s = await graph('GET', `/${c.id}`, { fields: 'status_code,status', access_token: token }, op);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw Object.assign(new Error(`Instagram não processou o vídeo: ${s.status || s.status_code}`), { rede: 'instagram' });
    if (Date.now() - t0 > maxMs) throw Object.assign(new Error('Instagram demorou demais para processar o vídeo.'), { rede: 'instagram', adiar: 1800000 });
    await sleep(pausaMs);
  }
  const pub = await graph('POST', `/${igUserId}/media_publish`, { creation_id: c.id, access_token: token }, op);
  let link = `https://www.instagram.com/`;
  try { link = (await graph('GET', `/${pub.id}`, { fields: 'permalink', access_token: token }, op)).permalink || link; } catch {}
  return { id: pub.id, link };
}

export async function publicarFacebook({ pageId, token, arquivo, legenda }, { fetchFn = fetch } = {}) {
  const op = { rede: 'facebook', fetchFn };
  const ini = await graph('POST', `/${pageId}/video_reels`, { upload_phase: 'start', access_token: token }, op);
  await enviarBinario(ini.upload_url || `${RUPLOAD}/video-upload/${GRAPH_VERSION}/${ini.video_id}`, token, arquivo, fetchFn);
  await graph('POST', `/${pageId}/video_reels`, { upload_phase: 'finish', video_id: ini.video_id, video_state: 'PUBLISHED', description: legenda, access_token: token }, op);
  return { id: ini.video_id, link: `https://www.facebook.com/reel/${ini.video_id}` };
}

// ---------- connecting (Facebook Login for Business with the reused app) ----------
export function urlLogin({ appId, configId, redirect, state }) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirect, state, response_type: 'code' });
  if (configId) { q.set('config_id', configId); q.set('override_default_response_type', 'true'); } else q.set('scope', ESCOPOS.join(','));
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${q}`;
}

// pure: which Page to use (the one already chosen, the only one, or the one called FNANDO)
export function escolherPagina(paginas, pageId = '') {
  return paginas.find((p) => p.id === pageId) || (paginas.length === 1 ? paginas[0] : null) || paginas.find((p) => /fnando/i.test(p.name || '')) || null;
}

export async function conectar({ appId, appSecret, redirect, code, pageId }, { fetchFn = fetch } = {}) {
  const get = async (u) => { const r = await fetchFn(u); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw erroGraph(j, r.status); return j; };
  const curto = await get(`${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirect, code })}`);
  const longo = await get(`${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: curto.access_token })}`);
  const fields = 'id,name,access_token,instagram_business_account{id,username}';
  const paginas = (await get(`${GRAPH}/me/accounts?${new URLSearchParams({ fields, limit: '100', access_token: longo.access_token })}`)).data || [];
  const p = escolherPagina(paginas, pageId);
  if (!p) throw new Error(paginas.length ? `Achei ${paginas.length} Páginas e nenhuma chamada FNANDO/Fnando.` : 'O Facebook não devolveu nenhuma Página: marque a Página Fnando na tela de permissões.');
  const ig = p.instagram_business_account;
  return { pageId: p.id, pageName: p.name, pageToken: p.access_token, igUserId: ig?.id || '', igUsername: ig?.username || '', conectadoEm: new Date().toISOString() };
}
