// Posting: approved cuts are scheduled on TikTok, Instagram Reels and YouTube Shorts in one call to Upload-Post
// (upload-post.com, already audited by TikTok for direct posting; the affiliate project uses it too).
// One cut per peak hour. Docs: https://docs.upload-post.com/api/upload-video
// Needs UPLOAD_POST_API_KEY in the environment and config.uploadPost.perfil (the profile created in Manage Users).
import fs from 'node:fs';
import path from 'node:path';
import { listarSessoes } from './painel.js';

const API = 'https://api.upload-post.com/api/upload';

// The caption each network reads. TikTok and Instagram take one text; YouTube a title (≤100) and a description.
export function textos(c) {
  const tags = (c.hashtags || []).map((h) => `#${h}`).join(' ');
  const legenda = [c.titulo, c.descricao, tags].filter(Boolean).join('\n\n');
  return {
    legenda: legenda.slice(0, 2200),
    tituloYoutube: `${String(c.titulo || '').slice(0, 90)} #shorts`.trim(),
    descricaoYoutube: [c.descricao, tags].filter(Boolean).join('\n\n').slice(0, 4900),
  };
}

// form fields of one post (pure, for the tests): [[name, value], ...]; the video goes in separately
export function camposPost(c, { perfil, redes, quando }) {
  const t = textos(c);
  const f = [['user', perfil], ...redes.map((r) => ['platform[]', r]), ['title', t.legenda]];
  if (redes.includes('tiktok')) f.push(['tiktok_title', t.legenda], ['privacy_level', 'PUBLIC_TO_EVERYONE'], ['cover_timestamp', '1000']);
  if (redes.includes('instagram')) f.push(['media_type', 'REELS'], ['share_to_feed', 'true']);
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

// automatic mode: a cut with a high score is approved without waiting for the owner
export function autoAprovar(cortes, notaMinima) {
  let n = 0;
  for (const c of cortes) if (c.status === 'aguardando' && Number(c.nota) >= notaMinima) { c.status = 'aprovado'; c.aprovadoPor = 'automatico'; n++; }
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
export async function postarAprovados(config, { log = console.log, agora = Date.now(), envio = enviar } = {}) {
  const up = config.uploadPost || {};
  const apiKey = process.env.UPLOAD_POST_API_KEY;
  if (!apiKey || !up.perfil) return 0;
  const redes = up.redes || ['tiktok', 'instagram', 'youtube'];
  const sessoes = listarSessoes(config.pastaSaida);
  const ocupados = sessoes.flatMap((s) => s.cortes.map((c) => c.agendadoPara).filter(Boolean));
  let n = 0;
  for (const s of sessoes) {
    const file = path.join(config.pastaSaida, s.pasta, 'sessao.json');
    const { pasta, ...dados } = s;
    let mudou = config.postarAutomatico ? autoAprovar(dados.cortes, config.notaMinima ?? 8) > 0 : false;
    // best score first, so the strongest cut gets the next peak hour
    for (const c of [...dados.cortes].filter((x) => x.status === 'aprovado').sort((a, b) => b.nota - a.nota)) {
      const quando = proximoHorario(agora, up.horarios || ['12:00', '18:30', '21:00'], ocupados);
      try {
        c.postId = await envio({ video: path.join(config.pastaSaida, pasta, c.arquivo), campos: camposPost(c, { perfil: up.perfil, redes, quando }), apiKey, chave: `${pasta}/${c.arquivo}` });
        c.status = 'agendado'; c.agendadoPara = quando; c.redes = redes; delete c.erroPost;
        ocupados.push(quando); n++;
        log(`Agendado para ${quando}: ${c.titulo}`);
      } catch (e) {
        c.erroPost = e.message;
        log(`Não agendou "${c.titulo}": ${e.message}`);
      }
      mudou = true;
    }
    const L = dados.longo;
    if (L && L.status === 'aprovado') {
      const quando = proximoHorario(agora, up.horariosLongo || ['19:00'], ocupados);
      try {
        L.postId = await envio({ video: path.join(config.pastaSaida, pasta, L.arquivo), thumb: L.thumb && path.join(config.pastaSaida, pasta, L.thumb), campos: camposLongo(L, { perfil: up.perfil, quando }), apiKey, chave: `${pasta}/${L.arquivo}` });
        L.status = 'agendado'; L.agendadoPara = quando; delete L.erroPost; ocupados.push(quando); n++;
        log(`Vídeo longo agendado para ${quando}: ${L.titulo}`);
      } catch (e) { L.erroPost = e.message; log(`Não agendou o vídeo longo: ${e.message}`); }
      mudou = true;
    }
    if (mudou) fs.writeFileSync(file, JSON.stringify(dados, null, 2));
  }
  return n;
}
