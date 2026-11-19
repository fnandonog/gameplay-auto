// YouTube Shorts (and the long videos in prontos/youtube-longo) through the YouTube Data API: refresh token → access token,
// resumable upload of the file from the Mac. Adapted from unirpdf lib/social/publish.js and oauth.js.
// A Google Cloud project that has not passed the YouTube API audit gets every upload locked as private; that is detected
// and shown in the Contas tab (the fix is the audit form, not code).
import fs from 'node:fs';

// force-ssl: to add each upload to its playlist (playlistItems.insert)
export const ESCOPOS = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';

export function erroYoutube(j, status) {
  const e = (j && j.error) || {};
  const motivo = e.errors?.[0]?.reason || e.status || '';
  const err = new Error(`YouTube: ${e.message || j?.error_description || `HTTP ${status}`}`);
  err.rede = 'youtube';
  if (j?.error === 'invalid_grant' || status === 401) { err.reconectar = true; err.message = 'YouTube: a autorização expirou ou foi revogada (projeto em modo de teste expira em 7 dias). Conecte de novo na aba Contas.'; }
  else if (['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded'].includes(motivo)) err.adiar = 6 * 3600000;
  else if (/suspend|terminat|strike|copyright|policy|violat/i.test(e.message || '')) err.grave = true;
  return err;
}

// pure: title, description and tags of the upload. Cuts are Shorts (#shorts in the title); long videos and missions are not.
export function metadadosYoutube(post) {
  const longo = post?.tipo === 'longo' || post?.tipo === 'missao';
  const y = post?.legendas?.youtube || {};
  let titulo = String(y.titulo || post?.titulo || 'FNANDO').replace(/[<>]/g, '').trim();
  if (!longo && !/#shorts/i.test(titulo)) titulo = titulo.length + 8 <= 100 ? `${titulo} #shorts` : titulo;
  const descricao = String(y.descricao || post?.descricao || '').replace(/[<>]/g, '');
  const tags = (post?.hashtags || []).map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 15);
  return {
    snippet: { title: titulo.slice(0, 100), description: descricao.slice(0, 5000), tags, categoryId: '20', defaultLanguage: 'pt-BR', defaultAudioLanguage: 'pt-BR' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
  };
}

// pure: the playlists an upload goes to. ids = config.youtube.playlists { shorts, curiosidades, dicas, missoes }.
// Shorts → Shorts + Dicas (tutorial/dica/como...) or Curiosidades; a mission → Missões completas; the whole session → none.
export function playlistsDoPost(post, ids = {}) {
  if (post?.tipo === 'longo') return [];
  if (post?.tipo === 'missao') return [ids.missoes].filter(Boolean);
  const texto = `${post?.titulo || ''} ${post?.gancho || ''} ${(post?.hashtags || []).join(' ')}`.toLowerCase();
  const dica = /dica|tutorial|como (fazer|pegar|ganhar|achar|conseguir)|truque|passo a passo|guia/.test(texto);
  return [ids.shorts, dica ? ids.dicas : ids.curiosidades].filter(Boolean);
}

let cache = null;
export async function tokenDeAcesso({ clientId, clientSecret, refreshToken }, { fetchFn = fetch } = {}) {
  if (cache && cache.refresh === refreshToken && cache.exp > Date.now() + 60000) return cache.token;
  const r = await fetchFn(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw erroYoutube(j, r.status);
  cache = { refresh: refreshToken, token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cache.token;
}

// custom thumbnail (thumbnails.set, 50 units). Needs a verified channel (phone) for custom thumbnails; a failure never
// undoes the upload, it only comes back as thumbErro.
export async function definirThumbYoutube(cred, videoId, capa, { fetchFn = fetch, token } = {}) {
  if (!capa || !fs.existsSync(capa)) return { thumb: false };
  const buf = fs.readFileSync(capa);
  if (buf.length > 2 * 1024 * 1024) return { thumb: false, thumbErro: 'capa maior que 2 MB' };
  token = token || await tokenDeAcesso(cred, { fetchFn });
  const r = await fetchFn(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'image/jpeg', 'content-length': String(buf.length) }, body: buf });
  if (r.ok) return { thumb: true };
  const j = await r.json().catch(() => ({}));
  return { thumb: false, thumbErro: String(j.error?.message || r.status).slice(0, 200) };
}

export async function publicarYoutube(cred, { arquivo, post, playlists = {}, capa = null }, { fetchFn = fetch } = {}) {
  const token = await tokenDeAcesso(cred, { fetchFn });
  const tamanho = fs.statSync(arquivo).size;
  const meta = metadadosYoutube(post);
  let r = await fetchFn(`${UPLOAD}?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(tamanho) }, body: JSON.stringify(meta) });
  if (!r.ok) throw erroYoutube(await r.json().catch(() => ({})), r.status);
  const sessao = r.headers.get('location');
  if (!sessao) throw Object.assign(new Error('YouTube não devolveu o endereço de envio.'), { rede: 'youtube' });
  r = await fetchFn(sessao, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'video/mp4', 'content-length': String(tamanho) }, body: fs.readFileSync(arquivo), signal: AbortSignal.timeout(60 * 60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw erroYoutube(j, r.status);
  let privacidade = j.status?.privacyStatus;
  try { const s = await (await fetchFn(`${API}/videos?part=status&id=${encodeURIComponent(j.id)}`, { headers: { Authorization: `Bearer ${token}` } })).json(); privacidade = s.items?.[0]?.status?.privacyStatus || privacidade; } catch {}
  const longo = post?.tipo === 'longo' || post?.tipo === 'missao';
  const listas = [];
  for (const pl of playlistsDoPost(post, playlists)) {
    try {
      const a = await fetchFn(`${API}/playlistItems?part=snippet`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ snippet: { playlistId: pl, resourceId: { kind: 'youtube#video', videoId: j.id } } }) });
      if (a.ok) listas.push(pl);
    } catch {} // a playlist that failed never undoes the upload
  }
  let th = {};
  try { th = await definirThumbYoutube(cred, j.id, capa, { fetchFn, token }); } catch (e) { th = { thumb: false, thumbErro: e.message }; }
  return { id: j.id, playlists: listas, ...th, link: longo ? `https://youtu.be/${j.id}` : `https://youtube.com/shorts/${j.id}`, travadoPrivado: privacidade === 'private' };
}

// ---------- connecting ----------
export function urlLogin({ clientId, redirect, state }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: ESCOPOS.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function conectar({ clientId, clientSecret, redirect, code }, { fetchFn = fetch } = {}) {
  const r = await fetchFn(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw erroYoutube(t, r.status);
  if (!t.refresh_token) throw new Error('O Google não devolveu o token de renovação: remova o acesso do app em myaccount.google.com/permissions e conecte de novo.');
  if (t.scope && !t.scope.includes('youtube.upload')) throw new Error('O Google não liberou "enviar vídeos" (youtube.upload): conecte de novo e marque todas as caixas.');
  const ch = await (await fetchFn(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${t.access_token}` } })).json().catch(() => ({}));
  const c = ch.items?.[0];
  if (!c) throw new Error('Esta conta do Google não tem canal do YouTube: escolha a conta fnando.gameplay@gmail.com.');
  return { refreshToken: t.refresh_token, channelId: c.id, channelTitle: c.snippet?.title || '', conectadoEm: new Date().toISOString() };
}
