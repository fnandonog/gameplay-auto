// Posting: approved cuts are scheduled on TikTok, Instagram Reels and YouTube Shorts in one call to Upload-Post
// (upload-post.com, already audited by TikTok for direct posting; the affiliate project uses it too).
// One cut per peak hour. Docs: https://docs.upload-post.com/api/upload-video
// Needs UPLOAD_POST_API_KEY in the environment and config.uploadPost.perfil (the profile created in Manage Users).
import fs from 'node:fs';
import path from 'node:path';
import { listarSessoes } from './painel.js';
import { linhasDe, linhaDoCorte, distribuirLinhas } from './canais.js';
import { registrar } from './atividade.js';
import { motivosRecusa, lerPausa, pausar, erroGrave, PADRAO_FILTRO } from './qualidade.js';

const API = 'https://api.upload-post.com/api/upload';

// The caption each network reads. TikTok and Instagram take one text; YouTube a title (≤100) and a description.
export function textos(c) {
  const tags = (c.hashtags || []).map((h) => `#${h}`).join(' ');
  // third-party cut (CLIPAÍ): the credit line always goes with it
  const credito = c.credito ? `Crédito: ${c.credito.streamer}${c.credito.link ? ` · ${c.credito.link}` : ''}` : '';
  const legenda = [c.titulo, c.descricao, credito, tags].filter(Boolean).join('\n\n');
  return {
    legenda: legenda.slice(0, 2200),
    tituloYoutube: `${String(c.titulo || '').slice(0, 90)} #shorts`.trim(),
    descricaoYoutube: [c.descricao, credito, tags].filter(Boolean).join('\n\n').slice(0, 4900),
  };
}

// form fields of one post (pure, for the tests): [[name, value], ...]; the video goes in separately
export function camposPost(c, { perfil, redes, quando, facebookPage }) {
  const t = textos(c);
  const f = [['user', perfil], ...redes.map((r) => ['platform[]', r]), ['title', t.legenda]];
  if (redes.includes('tiktok')) f.push(['tiktok_title', t.legenda], ['privacy_level', 'PUBLIC_TO_EVERYONE'], ['cover_timestamp', '1000']);
  if (redes.includes('instagram')) f.push(['media_type', 'REELS'], ['share_to_feed', 'true']);
  if (redes.includes('facebook')) {
    f.push(['facebook_media_type', 'REELS'], ['facebook_description', t.legenda]);
    if (facebookPage) f.push(['facebook_page_id', facebookPage]);
  }
  if (redes.includes('youtube')) {
    f.push(['youtube_title', t.tituloYoutube], ['youtube_description', t.descricaoYoutube], ['privacyStatus', 'public'], ['categoryId', '20']); // 20 = Gaming
    for (const h of c.hashtags || []) f.push(['tags[]', h]);
  }
  if (c.descricao && /\?/.test(c.descricao)) f.push(['first_comment', c.descricao.split(/(?<=\?)/)[0].trim()]);
  if (quando) f.push(['scheduled_date', quando]);
  f.push(['async_upload', 'true']);
  return f;
}

// the long video goes only to YouTube, with its thumbnail and chapters in the description
export function camposLongo(L, { perfil, quando }) {
  const f = [['user', perfil], ['platform[]', 'youtube'], ['title', String(L.titulo).slice(0, 100)], ['youtube_title', String(L.titulo).slice(0, 100)],
    ['youtube_description', String(L.descricao || '').slice(0, 4900)], ['privacyStatus', 'public'], ['categoryId', '20']];
  if (quando) f.push(['scheduled_date', quando]);
  f.push(['async_upload', 'true']);
  return f;
}

// Next free peak slot after `agora` (ms). horarios: ['12:00','18:00'] in Brasília time (UTC-3, no daylight saving).
// ocupados: ISO strings already taken. Returns an ISO string in UTC.
export function proximoHorario(agora, horarios, ocupados = [], { fusoHoras = -3, margemMin = 20 } = {}) {
  const tomados = new Set(ocupados);
  const min = agora + margemMin * 60000;
  const local = new Date(agora + fusoHoras * 3600000);
  for (let dia = 0; dia < 60; dia++) {
    for (const h of [...horarios].sort()) {
      const [hh, mm] = h.split(':').map(Number);
      const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dia, hh, mm) - fusoHoras * 3600000;
      const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
      if (t >= min && !tomados.has(iso)) return iso;
    }
  }
  throw new Error('Sem horário livre nos próximos 60 dias.');
}

// Autopilot: every waiting cut goes through the quality gate (src/qualidade.js). It passes → approved;
// it fails → discarded, with the reasons written on the cut so the owner can see why.
// `config` may be a number (the old minimum score).
export function autoAprovar(cortes, config = {}, linhas = []) {
  const cfg = typeof config === 'number' ? { filtro: { notaMinima: config } } : config;
  let n = 0;
  for (const c of cortes) {
    if (c.status !== 'aguardando') continue;
    const motivos = motivosRecusa(c, { config: cfg, linha: linhas.find((l) => l.id === c.linha) });
    if (motivos.length) { c.status = 'descartado'; c.descartadoPor = 'filtro'; c.filtro = motivos; continue; }
    c.status = 'aprovado'; c.aprovadoPor = 'automatico'; n++;
  }
  return n;
}

async function enviar({ video, thumb, campos, apiKey, chave }) {
  const form = new FormData();
  for (const [k, v] of campos) form.append(k, v);
  form.set('video', new Blob([fs.readFileSync(video)], { type: 'video/mp4' }), path.basename(video));
  if (thumb && fs.existsSync(thumb)) form.set('thumbnail', new Blob([fs.readFileSync(thumb)], { type: 'image/jpeg' }), path.basename(thumb));
  const r = await fetch(API, { method: 'POST', headers: { authorization: `Apikey ${apiKey}`, 'idempotency-key': chave }, body: form, signal: AbortSignal.timeout(10 * 60000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.success === false) throw new Error(`Upload-Post ${r.status}: ${body.message || body.error || 'recusou o post'}`);
  return body.job_id || body.request_id || body.id || 'ok';
}

// Schedules every approved cut of every session. Returns how many were scheduled.
// Schedules every approved cut of every session, each on its own line (profile, networks and peak hours).
// Returns how many were scheduled.
export async function postarAprovados(config, { log = console.log, agora = Date.now(), envio = enviar } = {}) {
  const up = config.uploadPost || {};
  const apiKey = process.env.UPLOAD_POST_API_KEY;
  const linhas = linhasDe(config).filter((l) => l.perfil);
  if (!apiKey || !linhas.length) return 0;
  const pausa = lerPausa(config.pastaSaida);
  if (pausa) { log(`Postagem pausada: ${pausa.motivo}. Retome no painel.`); return 0; }
  const errosParaPausar = config.filtro?.errosParaPausar ?? PADRAO_FILTRO.errosParaPausar;
  let errosSeguidos = 0;
  const perfilLongo = config.longo?.perfil || up.perfil || linhas[0].perfil;
  const sessoes = listarSessoes(config.pastaSaida);
  // a slot is taken per profile: two different accounts may post at the same hour
  const ocupados = sessoes.flatMap((s) => [...s.cortes, s.longo].filter((c) => c?.agendadoPara).map((c) => `${c.perfil || ''}|${c.agendadoPara}`));
  const livres = (perfil) => ocupados.filter((k) => k.startsWith(`${perfil}|`) || k.startsWith('|')).map((k) => k.split('|')[1]);
  const pasta0 = config.pastaSaida;
  let n = 0;
  for (const s of sessoes) {
    const file = path.join(pasta0, s.pasta, 'sessao.json');
    const { pasta, ...dados } = s;
    const antes = JSON.stringify(dados.cortes.map((c) => [c.linha, c.status]));
    distribuirLinhas(dados.cortes, linhas);
    if (config.postarAutomatico) autoAprovar(dados.cortes, config, linhas);
    let mudou = false;
    if (JSON.stringify(dados.cortes.map((c) => [c.linha, c.status])) !== antes) mudou = true;
    // best score first, so the strongest cut gets the next peak hour of its line
    for (const c of [...dados.cortes].filter((x) => x.status === 'aprovado').sort((a, b) => b.nota - a.nota)) {
      if (lerPausa(config.pastaSaida)) break;
      const linha = linhaDoCorte(c, linhas);
      const quando = proximoHorario(agora, linha.horarios || up.horarios || ['12:00', '18:30', '21:00'], livres(linha.perfil));
      try {
        registrar(pasta0, 'agendador', 'trabalhando', `Agendando "${c.titulo}" em ${linha.nome}`);
        c.postId = await envio({ video: path.join(pasta0, pasta, c.arquivo), campos: camposPost(c, { perfil: linha.perfil, redes: linha.redes, quando, facebookPage: linha.facebookPage }), apiKey, chave: `${pasta}/${c.arquivo}` });
        c.status = 'agendado'; c.agendadoPara = quando; c.redes = linha.redes; c.perfil = linha.perfil; c.linha = linha.id; delete c.erroPost;
        ocupados.push(`${linha.perfil}|${quando}`); n++; errosSeguidos = 0;
        log(`Agendado para ${quando} em ${linha.nome}: ${c.titulo}`);
      } catch (e) {
        c.erroPost = e.message;
        registrar(pasta0, 'agendador', 'erro', `Não agendou "${c.titulo}": ${e.message}`);
        errosSeguidos++;
        if (erroGrave(e.message) || errosSeguidos >= errosParaPausar) {
          pausar(pasta0, erroGrave(e.message) ? `a plataforma recusou: ${e.message}` : `${errosSeguidos} erros seguidos (último: ${e.message})`);
          registrar(pasta0, 'agendador', 'erro', 'Postagem pausada. Retome no painel depois de conferir.');
        }
        log(`Não agendou "${c.titulo}": ${e.message}`);
      }
      mudou = true;
    }
    const L = dados.longo;
    if (L && config.postarAutomatico && L.status === 'aguardando') { L.status = 'aprovado'; L.aprovadoPor = 'automatico'; mudou = true; }
    if (L && L.status === 'aprovado' && !lerPausa(config.pastaSaida)) {
      const quando = proximoHorario(agora, config.longo?.horarios || up.horariosLongo || ['19:00'], livres(perfilLongo));
      try {
        L.postId = await envio({ video: path.join(pasta0, pasta, L.arquivo), thumb: L.thumb && path.join(pasta0, pasta, L.thumb), campos: camposLongo(L, { perfil: perfilLongo, quando }), apiKey, chave: `${pasta}/${L.arquivo}` });
        L.status = 'agendado'; L.agendadoPara = quando; L.perfil = perfilLongo; delete L.erroPost; ocupados.push(`${perfilLongo}|${quando}`); n++;
        log(`Vídeo longo agendado para ${quando}: ${L.titulo}`);
      } catch (e) { L.erroPost = e.message; log(`Não agendou o vídeo longo: ${e.message}`); }
      mudou = true;
    }
    if (mudou) fs.writeFileSync(file, JSON.stringify(dados, null, 2));
  }
  if (n) registrar(pasta0, 'agendador', 'pronto', `${n} post(s) agendado(s)`);
  return n;
}
