// Network numbers for the dashboard, read straight from the official APIs every few hours (no AI, no tokens):
// YouTube (subscribers, total views, views per video), Instagram (followers, likes and comments per post),
// Facebook Page (followers). TikTok has no API here: the extension can send its numbers to /api/metricas/tiktok.
// Writes config.arquivoMetricas: { atualizadoEm, contas: [...], historico: [{ dia, seguidores, views, porRede }], posts: { link: {...} } }
import fs from 'node:fs';
import path from 'node:path';
import { graph } from './postadores/meta.js';
import { tokenDeAcesso } from './postadores/youtube.js';
import { arquivoCredenciais, lerCredenciais } from './credenciais.js';
import { listarEntregues } from './postador.js';
import { registrar } from './atividade.js';

const lerJson = (f, p = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return p; } };
const YT = 'https://www.googleapis.com/youtube/v3';

// pure: the YouTube video id inside a link
export function idDoYoutube(link) {
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{11})/.exec(String(link || ''));
  return m ? m[1] : null;
}

// pure: today's snapshot goes into the history (one row per day, the last reading of the day wins); keeps 365 days
export function juntarHistorico(historico = [], contas = [], agora = new Date(), fusoHoras = -3) {
  const dia = new Date(agora.getTime() + fusoHoras * 3600e3).toISOString().slice(0, 10);
  const porRede = {};
  for (const c of contas) porRede[c.rede] = { seguidores: c.seguidores || 0, views: c.views || 0 };
  const linha = { dia, seguidores: contas.reduce((n, c) => n + (c.seguidores || 0), 0), views: contas.reduce((n, c) => n + (c.views || 0), 0), porRede };
  return [...historico.filter((h) => h.dia !== dia), linha].sort((a, b) => a.dia.localeCompare(b.dia)).slice(-365);
}

// pure: views and followers gained in the last n days, from the history
export function ganho(historico, rede, campo, dias = 7) {
  const h = historico.filter((x) => (rede ? x.porRede?.[rede] : x));
  if (h.length < 2) return 0;
  const val = (x) => (rede ? x.porRede[rede][campo] : x[campo]) || 0;
  const fim = h.at(-1), ini = h.find((x) => (Date.parse(fim.dia) - Date.parse(x.dia)) / 864e5 <= dias) || h[0];
  return Math.max(0, val(fim) - val(ini));
}

async function youtube(c, links, fetchFn) {
  const token = await tokenDeAcesso(c, { fetchFn });
  const get = async (u) => { const r = await fetchFn(u, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) }); const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || `YouTube ${r.status}`); return j; };
  const ch = (await get(`${YT}/channels?part=statistics,snippet&mine=true`)).items?.[0];
  if (!ch) throw new Error('YouTube: nenhum canal nesta conta.');
  const posts = {};
  const ids = [...new Set(links.map(idDoYoutube).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await get(`${YT}/videos?part=statistics,status&id=${ids.slice(i, i + 50).join(',')}`);
    for (const v of j.items || []) posts[v.id] = { views: +v.statistics.viewCount || 0, curtidas: +v.statistics.likeCount || 0, comentarios: +v.statistics.commentCount || 0, privado: v.status?.privacyStatus !== 'public' };
  }
  const s = ch.statistics;
  return { conta: { rede: 'youtube', nome: ch.snippet.title, arroba: ch.snippet.customUrl || '', seguidores: +s.subscriberCount || 0, views: +s.viewCount || 0, posts: +s.videoCount || 0, link: `https://www.youtube.com/channel/${ch.id}` }, posts };
}

async function instagram(m, fetchFn) {
  const u = await graph('GET', `/${m.igUserId}`, { fields: 'username,followers_count,media_count', access_token: m.pageToken }, { rede: 'instagram', fetchFn });
  const media = await graph('GET', `/${m.igUserId}/media`, { fields: 'permalink,like_count,comments_count,timestamp', limit: 100, access_token: m.pageToken }, { rede: 'instagram', fetchFn });
  const posts = {};
  for (const x of media.data || []) posts[x.permalink] = { curtidas: x.like_count || 0, comentarios: x.comments_count || 0 };
  const curtidas = Object.values(posts).reduce((n, p) => n + p.curtidas, 0);
  return { conta: { rede: 'instagram', nome: u.username, arroba: `@${u.username}`, seguidores: u.followers_count || 0, views: 0, curtidas, posts: u.media_count || 0, link: `https://www.instagram.com/${u.username}` }, posts };
}

async function facebook(m, fetchFn) {
  const p = await graph('GET', `/${m.pageId}`, { fields: 'name,followers_count,fan_count,link', access_token: m.pageToken }, { fetchFn });
  return { conta: { rede: 'facebook', nome: p.name, arroba: '', seguidores: p.followers_count || p.fan_count || 0, views: 0, posts: 0, link: p.link || `https://www.facebook.com/${m.pageId}` }, posts: {} };
}

export async function coletarMetricas(config, { fetchFn = fetch, log = console.log, agora = new Date() } = {}) {
  const c = lerCredenciais(arquivoCredenciais(config));
  const antes = lerJson(config.arquivoMetricas, {}) || {};
  const links = listarEntregues(config.pastaEntrega).flatMap((p) => Object.values(p.postado?.links || {}));
  const contas = [], posts = { ...(antes.posts || {}) }, erros = {};
  const tarefas = [];
  if (c.youtube.refreshToken) tarefas.push(['youtube', () => youtube(c.youtube, links, fetchFn)]);
  if (c.meta.pageToken && c.meta.igUserId) tarefas.push(['instagram', () => instagram(c.meta, fetchFn)]);
  if (c.meta.pageToken && c.meta.pageId) tarefas.push(['facebook', () => facebook(c.meta, fetchFn)]);
  for (const [rede, f] of tarefas) {
    try { const r = await f(); contas.push({ ...r.conta, linha: 'principal' }); Object.assign(posts, r.posts); }
    catch (e) { erros[rede] = e.message; const velha = (antes.contas || []).find((x) => x.rede === rede); if (velha) contas.push({ ...velha, erro: e.message }); }
  }
  const tiktok = (antes.contas || []).find((x) => x.rede === 'tiktok'); // sent by the extension
  if (tiktok) contas.push(tiktok);
  const historico = juntarHistorico(antes.historico, contas, agora);
  for (const x of contas) { x.views7d = ganho(historico, x.rede, 'views'); x.ganho7d = ganho(historico, x.rede, 'seguidores'); }
  const out = { atualizadoEm: agora.toISOString(), contas, historico, posts, erros };
  fs.mkdirSync(path.dirname(config.arquivoMetricas), { recursive: true });
  fs.writeFileSync(config.arquivoMetricas + '.tmp', JSON.stringify(out, null, 2));
  fs.renameSync(config.arquivoMetricas + '.tmp', config.arquivoMetricas);
  registrar(config.pastaSaida, 'analista', Object.keys(erros).length ? 'erro' : 'pronto', `Números das redes: ${contas.map((x) => `${x.rede} ${x.seguidores}`).join(', ') || 'nenhuma conectada'}`);
  if (Object.keys(erros).length) log(`Métricas: ${Object.entries(erros).map(([r, e]) => `${r}: ${e}`).join('; ')}`);
  return out;
}

// numbers the TikTok extension reads on the profile page (followers, likes, views of the last videos)
export function salvarTiktok(config, { seguidores, curtidas, views, arroba } = {}, agora = new Date()) {
  const m = lerJson(config.arquivoMetricas, {}) || {};
  const contas = (m.contas || []).filter((x) => x.rede !== 'tiktok');
  contas.push({ rede: 'tiktok', linha: 'principal', arroba: String(arroba || ''), nome: String(arroba || 'TikTok'), seguidores: +seguidores || 0, curtidas: +curtidas || 0, views: +views || 0, link: arroba ? `https://www.tiktok.com/${arroba}` : '' });
  m.contas = contas; m.historico = juntarHistorico(m.historico, contas, agora); m.atualizadoEm = agora.toISOString();
  fs.writeFileSync(config.arquivoMetricas, JSON.stringify(m, null, 2));
  return m;
}

export function iniciarMetricas(config, { horas = 3, log = console.log } = {}) {
  const vez = () => coletarMetricas(config, { log }).catch((e) => log(`Métricas: ${e.message}`));
  const m = lerJson(config.arquivoMetricas, null);
  if (!m?.atualizadoEm || Date.now() - Date.parse(m.atualizadoEm) > horas * 3600e3) setTimeout(vez, 20000);
  const t = setInterval(vez, horas * 3600e3);
  return () => clearInterval(t);
}
