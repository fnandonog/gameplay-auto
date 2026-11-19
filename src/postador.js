// The poster: every few minutes, with config.postadorLigado, takes ONE delivered post whose agendarPara is due and posts it
// on ONE network still missing (Instagram, Facebook Page, YouTube through the official APIs; TikTok goes through the Chrome
// extension, src/tiktokChrome.js). One upload per round, never a burst, and never more per network per day than the safe
// limits (src/canais.js). A post with a warning (aviso: nudity/gore on screen) never goes out on its own.
// Results: postado.json { em, links: { rede: url }, emRede: { rede: iso } } (links of other networks are kept);
// failures: .postador.json { rede: { tentativas, erro, proximaEm } } in the post folder. A platform pushing back (grave)
// pulls the brake (.pausa.json) for everything; an expired token stops only that network until it is reconnected.
import fs from 'node:fs';
import path from 'node:path';
import { LIMITES_SEGUROS } from './canais.js';
import { lerPausa, pausar } from './qualidade.js';
import { registrar } from './atividade.js';
import { arquivoCredenciais, lerCredenciais, salvarCredenciais } from './credenciais.js';
import { publicarInstagram, publicarFacebook, legendaMeta } from './postadores/meta.js';
import { publicarYoutube } from './postadores/youtube.js';

export const REDES_API = ['instagram', 'facebook', 'youtube'];
export const MAX_TENTATIVAS = 3;
const ESPERAS = [15 * 60000, 60 * 60000, 6 * 3600000];
const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const nome = (s) => s && !s.startsWith('.');

// every delivered post with its state
export function listarEntregues(base) {
  const out = [];
  let linhas = []; try { linhas = fs.readdirSync(base).filter(nome); } catch {}
  for (const linha of linhas) {
    let pastas = []; try { pastas = fs.readdirSync(path.join(base, linha)).filter(nome); } catch {}
    for (const pasta of pastas) {
      const dir = path.join(base, linha, pasta);
      const post = ler(path.join(dir, 'post.json'));
      if (!post || !fs.existsSync(path.join(dir, 'video.mp4'))) continue;
      out.push({ id: `${linha}/${pasta}`, dir, post, postado: ler(path.join(dir, 'postado.json')) || {}, estado: ler(path.join(dir, '.postador.json')) || {} });
    }
  }
  return out;
}

const dia = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
// pure: how many posts each network already got today (São Paulo day)
export function contagemHoje(posts, agora) {
  const hoje = dia(agora), n = {};
  for (const p of posts) for (const [rede, em] of Object.entries(p.postado.emRede || {})) if (em && dia(Date.parse(em)) === hoje) n[rede] = (n[rede] || 0) + 1;
  return n;
}

// pure: the next (post, network) to send, or null. conectadas = networks with working credentials.
export function proximoEnvio(posts, { agora = Date.now(), conectadas = REDES_API, limites = {} } = {}) {
  const lim = { ...LIMITES_SEGUROS, ...limites };
  const feitos = contagemHoje(posts, agora);
  const fila = posts
    .filter((p) => !p.post.aviso && (!p.post.agendarPara || Date.parse(p.post.agendarPara) <= agora))
    .sort((a, b) => (b.post.postarJa ? 1 : 0) - (a.post.postarJa ? 1 : 0) || String(a.post.agendarPara || a.post.criadoEm || '').localeCompare(String(b.post.agendarPara || b.post.criadoEm || '')));
  for (const p of fila) {
    for (const rede of (p.post.linha?.redes || []).filter((r) => REDES_API.includes(r) && conectadas.includes(r))) {
      if (p.postado.links?.[rede]) continue;
      const e = p.estado[rede] || {};
      if (e.tentativas >= MAX_TENTATIVAS || (e.proximaEm && Date.parse(e.proximaEm) > agora)) continue;
      if ((feitos[rede] || 0) >= (lim[rede] ?? 3)) continue;
      return { post: p, rede };
    }
  }
  return null;
}

// pure: networks whose credentials are complete
export function redesConectadas(c) {
  const out = [];
  const m = c.meta || {}, y = c.youtube || {};
  if (m.appSecret && m.pageToken && m.igUserId && !m.erro) out.push('instagram');
  if (m.appSecret && m.pageToken && m.pageId && !m.erro) out.push('facebook');
  if (y.clientSecret && y.refreshToken && !y.erro) out.push('youtube');
  return out;
}

export function gravarSucesso(dir, rede, link, agora = Date.now()) {
  const f = path.join(dir, 'postado.json');
  const antes = ler(f) || {};
  const em = new Date(agora).toISOString();
  const novo = { ...antes, em: antes.em || em, links: { ...(antes.links || {}), [rede]: link || 'publicado' }, emRede: { ...(antes.emRede || {}), [rede]: em } };
  fs.writeFileSync(f, JSON.stringify(novo, null, 2));
  return novo;
}

export function gravarFalha(dir, rede, err, agora = Date.now()) {
  const f = path.join(dir, '.postador.json');
  const e = ler(f) || {};
  const t = (e[rede]?.tentativas || 0) + 1;
  const espera = err.adiar || ESPERAS[Math.min(t - 1, ESPERAS.length - 1)];
  e[rede] = { tentativas: err.adiar ? (e[rede]?.tentativas || 0) : t, erro: String(err.message || err).slice(0, 300), em: new Date(agora).toISOString(), proximaEm: new Date(agora + espera).toISOString(), reconectar: !!err.reconectar };
  fs.writeFileSync(f, JSON.stringify(e, null, 2));
  return e[rede];
}

const PUBLICAR = {
  instagram: (c, p) => publicarInstagram({ igUserId: c.meta.igUserId, token: c.meta.pageToken, arquivo: path.join(p.dir, 'video.mp4'), legenda: legendaMeta(p.post, 'instagram') }),
  facebook: (c, p) => publicarFacebook({ pageId: c.meta.pageId, token: c.meta.pageToken, arquivo: path.join(p.dir, 'video.mp4'), legenda: legendaMeta(p.post, 'facebook') }),
  youtube: (c, p, config) => publicarYoutube(c.youtube, { arquivo: path.join(p.dir, 'video.mp4'), post: p.post, playlists: config.youtube?.playlists || {} }),
};

// One round. Returns what it did (for the log and the tests).
export async function rodadaPostador(config, { agora = Date.now(), publicar = PUBLICAR, log = console.log } = {}) {
  if (!config.postadorLigado) return { feito: 'desligado' };
  if (lerPausa(config.pastaSaida)) return { feito: 'pausado' };
  const credFile = arquivoCredenciais(config);
  const cred = lerCredenciais(credFile);
  const conectadas = redesConectadas(cred);
  if (!conectadas.length) return { feito: 'sem redes conectadas' };
  const posts = listarEntregues(config.pastaEntrega);
  const prox = proximoEnvio(posts, { agora, conectadas, limites: config.limites });
  if (!prox) return { feito: 'nada vencido' };
  const { post: p, rede } = prox;
  registrar(config.pastaSaida, 'agendador', 'trabalhando', `Postando "${p.post.titulo}" no ${rede}`);
  try {
    const r = await publicar[rede](cred, p, config);
    gravarSucesso(p.dir, rede, r.link, agora);
    if (rede === 'youtube' && r.travadoPrivado !== undefined) salvarCredenciais(credFile, 'youtube', { travadoPrivado: !!r.travadoPrivado });
    registrar(config.pastaSaida, 'agendador', 'pronto', `Publicado no ${rede}: "${p.post.titulo}"${r.travadoPrivado ? ' (o YouTube travou como privado)' : ''}`);
    log(`Postador: ${rede} ← ${p.id} ${r.link || ''}`);
    return { feito: 'publicado', rede, id: p.id, link: r.link };
  } catch (e) {
    const st = gravarFalha(p.dir, rede, e, agora);
    if (e.reconectar) salvarCredenciais(credFile, rede === 'youtube' ? 'youtube' : 'meta', { erro: e.message });
    if (e.grave) pausar(config.pastaSaida, `${rede} recusou: ${e.message}`);
    registrar(config.pastaSaida, 'agendador', 'erro', `${rede}: ${e.message}`);
    log(`Postador: ${rede} falhou em ${p.id}: ${e.message}`);
    return { feito: 'erro', rede, id: p.id, erro: e.message, grave: !!e.grave, estado: st };
  }
}

// one round at a time in this process: the 5-minute timer and the owner's "Postar agora" share the same lock
let rodando = false;

// "Postar agora" on the central: this post jumps the queue now (still one upload at a time, still the daily limits,
// still never a post with a warning). TikTok picks it up on the extension's next check.
export async function postarAgora(config, id, { log = console.log, agora = Date.now() } = {}) {
  const [linha, pasta] = String(id || '').split('/');
  if (!nome(linha) || !nome(pasta) || linha !== path.basename(linha) || pasta !== path.basename(pasta)) throw new Error('Post inválido.');
  const f = path.join(config.pastaEntrega, linha, pasta, 'post.json');
  const post = ler(f);
  if (!post) throw new Error('Post não encontrado.');
  if (post.aviso) throw new Error(`Este post tem aviso (${post.aviso}) e não sai sozinho.`);
  const novo = { ...post, agendadoAntes: post.agendadoAntes || post.agendarPara || null, agendarPara: new Date(agora).toISOString(), postarJa: true };
  fs.writeFileSync(f, JSON.stringify(novo, null, 2));
  registrar(config.pastaSaida, 'agendador', 'trabalhando', `Você mandou postar agora: "${post.titulo}"`);
  const feitos = [];
  if (!rodando) {
    rodando = true;
    try {
      for (let i = 0; i < REDES_API.length; i++) {
        const r = await rodadaPostador(config, { log });
        feitos.push(r);
        if (r.feito !== 'publicado' && r.feito !== 'erro') break;
      }
    } finally { rodando = false; }
  }
  return { agendarPara: novo.agendarPara, feitos };
}

export function iniciarPostador(config, { intervaloMin = 5, log = console.log } = {}) {
  if (!config.postadorLigado) { log('Postador das APIs desligado (postadorLigado: false no config.json).'); return () => {}; }
  const vez = async () => {
    if (rodando) return;
    rodando = true;
    try { await rodadaPostador(config, { log }); } catch (e) { log(`Postador: ${e.message}`); } finally { rodando = false; }
  };
  log(`Postador das APIs ligado: um envio por vez, a cada ${intervaloMin} min, só no horário agendado.`);
  vez();
  const t = setInterval(vez, intervaloMin * 60000);
  return () => clearInterval(t);
}
