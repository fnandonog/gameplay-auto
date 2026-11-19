// Approval panel: a page (works on the phone, same Wi-Fi as the Mac) listing the cuts of each session, with the video,
// the title and description to edit, and Approve / Discard. Decisions go to each session's sessao.json.
// No dependencies: node:http, files served with Range (the phone's player needs it).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerAtividade, quadroEscritorio } from './atividade.js';
import { linhasDe } from './canais.js';
import { lerPausa, retomar } from './qualidade.js';
import { lerContas, salvarConta } from './contas.js';
import { coletarMetricas, salvarTiktok } from './metricas.js';
import { lerRadar, sincronizarRadar } from './radar.js';
import { listarBrutos, listarRoteiros, listarProntos, lerRedes, resumo, receberEnvio, prontidao } from './central.js';
import { arquivoToken, garantirToken, bearerOk, assinaturaOk, proximoJob, arquivoDoVideo, registrarResultado } from './tiktokChrome.js';
import { registrar } from './atividade.js';
import crypto from 'node:crypto';
import { arquivoCredenciais, lerCredenciais, salvarCredenciais, statusApis, aplicarChaveIa } from './credenciais.js';
import * as metaApi from './postadores/meta.js';
import * as ytApi from './postadores/youtube.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINA = path.join(ROOT, 'public', 'painel.html');
const ESCRITORIO = path.join(ROOT, 'public', 'escritorio.html');
const CENTRAL = path.join(ROOT, 'public', 'central.html');
const MARCA = path.join(ROOT, 'public', 'marca');
const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }; // only the cuts and their covers are served
const EXTENSAO = path.join(ROOT, 'extensao-tiktok', 'manifest.json');
// the TikTok Studio page downloads the video (CORS + Chrome's private network access preflight)
const CORS_TIKTOK = { 'access-control-allow-origin': 'https://www.tiktok.com', 'access-control-allow-private-network': 'true', 'access-control-allow-headers': 'range', 'vary': 'origin' };
const estadosOauth = new Map(); // state → { rede, em }, 10 min
const novoEstado = (rede) => { const s = crypto.randomBytes(16).toString('hex'); estadosOauth.set(s, { rede, em: Date.now() }); return s; };
const usarEstado = (s, rede) => { const e = estadosOauth.get(s); estadosOauth.delete(s); return !!e && e.rede === rede && Date.now() - e.em < 600000; };
const CAMPOS = { meta: ['appId', 'appSecret', 'configId'], youtube: ['clientId', 'clientSecret'], ia: ['apiKey'] };
const local = (req) => /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
export const STATUS = ['aguardando', 'aprovado', 'descartado', 'agendado', 'entregue', 'postado'];

// a name that came from the URL must be a plain file/folder name inside the output folder
export const nomeSeguro = (s) => typeof s === 'string' && s.length > 0 && s === path.basename(s) && !s.startsWith('.');

// a file inside the session folder, at most one subfolder deep (missoes/01-x.mp4)
export const caminhoSeguro = (s) => typeof s === 'string' && s.split('/').length <= 2 && s.split('/').every(nomeSeguro);

export function listarSessoes(pastaSaida) {
  if (!fs.existsSync(pastaSaida)) return [];
  return fs.readdirSync(pastaSaida)
    .filter((d) => fs.existsSync(path.join(pastaSaida, d, 'sessao.json')))
    .map((d) => ({ pasta: d, ...JSON.parse(fs.readFileSync(path.join(pastaSaida, d, 'sessao.json'), 'utf8')) }))
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

// applies an edit to one cut; returns the cut or throws
export function editarCorte(pastaSaida, { pasta, arquivo, ...mud }, linhas = null) {
  if (!nomeSeguro(pasta) || !caminhoSeguro(arquivo)) throw new Error('Corte inválido.');
  const file = path.join(pastaSaida, pasta, 'sessao.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = s.cortes.find((x) => x.arquivo === arquivo || Object.values(x.variantes || {}).includes(arquivo)) || (s.longo?.arquivo === arquivo ? s.longo : null) || (s.missoes || []).find((x) => x.arquivo === arquivo);
  if (!c) throw new Error('Corte não encontrado.');
  if (mud.status !== undefined) {
    if (!STATUS.includes(mud.status)) throw new Error('Status inválido.');
    c.status = mud.status;
    if (mud.status === 'aprovado') { delete c.filtro; delete c.barrado; c.aprovadoPor = 'dono'; }
    if (mud.status === 'descartado') c.descartadoPor = 'dono';
  }
  if (mud.linha !== undefined) { if (linhas && !linhas.some((l) => l.id === mud.linha)) throw new Error('Linha inválida.'); c.linha = String(mud.linha); }
  // another rendered format becomes the one that is posted
  if (mud.formato !== undefined && mud.formato !== c.formato) {
    const novo = c.variantes?.[mud.formato];
    if (!novo) throw new Error('Formato inválido.');
    c.formato = String(mud.formato); c.arquivo = novo;
    const jpg = novo.replace(/\.mp4$/, '.jpg');
    if (fs.existsSync(path.join(pastaSaida, pasta, jpg))) c.capa = jpg;
  }
  if (typeof mud.titulo === 'string') c.titulo = mud.titulo.slice(0, 100);
  if (typeof mud.descricao === 'string') c.descricao = mud.descricao.slice(0, 5000);
  if (Array.isArray(mud.hashtags)) c.hashtags = mud.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  c.atualizadoEm = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  return c;
}

function servirArquivo(req, res, file, extra = {}) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { ...extra, 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' }); return fs.createReadStream(file).pipe(res); }
  const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
  if (start >= stat.size) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); return res.end(); }
  res.writeHead(206, { ...extra, 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' });
  fs.createReadStream(file, { start, end }).pipe(res);
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

export function criarPainel(config) {
  const senha = config.senhaPainel || '';
  const autorizado = (req) => !senha || (req.headers.cookie || '').split(/;\s*/).includes(`painel=${encodeURIComponent(senha)}`);
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (senha && url.searchParams.get('senha') === senha) {
        res.writeHead(302, { location: '/', 'set-cookie': `painel=${encodeURIComponent(senha)}; HttpOnly; SameSite=Strict; Max-Age=31536000; Path=/` });
        return res.end();
      }
      // TikTok through Chrome (src/tiktokChrome.js): the extension has its own code, so these come before the panel password
      if (url.pathname.startsWith('/api/tiktok-chrome/')) {
        const token = garantirToken(arquivoToken(config));
        const rota = url.pathname.slice('/api/tiktok-chrome/'.length);
        if (req.method === 'OPTIONS' && rota.startsWith('video/')) { res.writeHead(204, { ...CORS_TIKTOK, 'access-control-allow-methods': 'GET' }); return res.end(); }
        if (req.method === 'GET' && rota === 'versao') {
          let versao = null; try { versao = JSON.parse(fs.readFileSync(EXTENSAO, 'utf8')).version; } catch {}
          return json(res, 200, { versao });
        }
        // the code is shown only to someone on this Mac (the Contas tab), never over the Wi-Fi
        if (req.method === 'GET' && rota === 'codigo') return local(req) && autorizado(req) ? json(res, 200, { codigo: token }) : json(res, 403, { erro: 'Só no próprio Mac.' });
        if (req.method === 'GET' && rota.startsWith('video/')) {
          const id = decodeURIComponent(rota.slice('video/'.length));
          if (!assinaturaOk(token, id, url.searchParams.get('t')) && !bearerOk(req.headers.authorization, token)) return json(res, 401, { erro: 'Código inválido.' });
          const file = arquivoDoVideo(config.pastaEntrega, id);
          return file ? servirArquivo(req, res, file, CORS_TIKTOK) : json(res, 404, { erro: 'Não encontrado.' });
        }
        if (!bearerOk(req.headers.authorization, token)) return json(res, 401, { erro: 'Código inválido: copie o código da aba Contas da central.' });
        if (req.method === 'GET' && rota === 'proximo') {
          const job = proximoJob({ base: config.pastaEntrega, token, pausa: lerPausa(config.pastaSaida), limite: { tiktok: 4, ...(config.limites || {}) }.tiktok });
          if (job) registrar(config.pastaSaida, 'agendador', 'trabalhando', `TikTok pelo Chrome: postando "${job.titulo}"`);
          return json(res, 200, { job });
        }
        if (req.method === 'POST' && rota === 'resultado') {
          let body = '';
          req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
          req.on('end', () => {
            try {
              const r = registrarResultado(config.pastaEntrega, JSON.parse(body || '{}'));
              registrar(config.pastaSaida, 'agendador', r.ok ? 'pronto' : 'erro', r.ok ? 'TikTok pelo Chrome: vídeo publicado' : `TikTok pelo Chrome parou: ${r.estado.erro}`);
              json(res, 200, r);
            } catch (e) { json(res, 400, { erro: e.message }); }
          });
          return;
        }
        return json(res, 404, { erro: 'Não encontrado.' });
      }
      if (!autorizado(req)) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Abra o endereço com ?senha=...'); }
      const pagina = (f) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return fs.createReadStream(f).pipe(res); };
      if (req.method === 'GET' && url.pathname === '/') return pagina(CENTRAL);
      if (req.method === 'GET' && url.pathname === '/cortes') return pagina(PAGINA);
      if (req.method === 'GET' && url.pathname === '/api/central') {
        const sessoes = listarSessoes(config.pastaSaida);
        sincronizarRadar(config).catch(() => {});
        const radar = lerRadar(config);
        radar.itens = radar.itens.map((i) => ({ ...i, cortes: sessoes.flatMap((s) => (s.cortes || []).filter((c) => c.radar === i.id).map((c) => ({ pasta: s.pasta, titulo: c.titulo, status: c.status }))) }));
        const dados = { brutos: listarBrutos(config), sessoes, roteiros: listarRoteiros(config), prontos: listarProntos(config), redes: lerRedes(config), radar };
        return json(res, 200, { ...dados, resumo: resumo(dados), pastas: { entrada: config.pastaEntrada, saida: config.pastaSaida, entrega: config.pastaEntrega, roteiros: config.pastaRoteiros, metricas: config.arquivoMetricas } });
      }
      if (req.method === 'GET' && url.pathname === '/api/prontidao') { prontidao(config).then((r) => json(res, 200, r), (e) => json(res, 500, { erro: e.message })); return; }
      if (req.method === 'POST' && url.pathname === '/api/enviar') {
        receberEnvio(req, config, url.searchParams.get('nome')).then((r) => json(res, 200, r), (e) => json(res, 400, { erro: e.message }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/sessoes') return json(res, 200, listarSessoes(config.pastaSaida));
      if (req.method === 'GET' && url.pathname === '/escritorio') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return fs.createReadStream(ESCRITORIO).pipe(res); }
      if (req.method === 'GET' && url.pathname === '/api/pausa') return json(res, 200, { pausa: lerPausa(config.pastaSaida), automatico: !!config.postarAutomatico });
      if (req.method === 'POST' && url.pathname === '/api/retomar') { retomar(config.pastaSaida); return json(res, 200, { pausa: null }); }
      if (req.method === 'GET' && url.pathname === '/api/linhas') return json(res, 200, linhasDe(config).map(({ id, nome, redes, conteudo, terceiros }) => ({ id, nome, redes, conteudo, terceiros: !!terceiros })));
      if (req.method === 'GET' && url.pathname === '/api/escritorio') {
        return json(res, 200, quadroEscritorio({ atividade: lerAtividade(config.pastaSaida), sessoes: listarSessoes(config.pastaSaida), linhas: linhasDe(config), config, pausa: lerPausa(config.pastaSaida) }));
      }
      const marca = /^\/marca\/([^/]+\.(svg|png))$/.exec(url.pathname);
      if (req.method === 'GET' && marca && nomeSeguro(marca[1]) && fs.existsSync(path.join(MARCA, marca[1]))) {
        res.writeHead(200, { 'content-type': marca[2] === 'svg' ? 'image/svg+xml' : 'image/png', 'cache-control': 'max-age=3600' });
        return fs.createReadStream(path.join(MARCA, marca[1])).pipe(res);
      }
      // official APIs (src/postador.js): status, keys pasted by the owner (only on this Mac) and the OAuth "Conectar"
      if (req.method === 'GET' && url.pathname === '/api/apis') {
        return json(res, 200, { ...statusApis(lerCredenciais(arquivoCredenciais(config))), postador: { ligado: !!config.postadorLigado, automatico: !!config.postarAutomatico, pausa: lerPausa(config.pastaSaida) } });
      }
      if (req.method === 'POST' && url.pathname === '/api/credenciais') {
        if (!local(req)) return json(res, 403, { erro: 'Só no próprio Mac.' });
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => {
          try {
            const { rede, ...v } = JSON.parse(body || '{}');
            if (!CAMPOS[rede]) throw new Error('Rede inválida.');
            const patch = {};
            for (const k of CAMPOS[rede]) if (typeof v[k] === 'string' && v[k].trim()) patch[k] = v[k].trim().slice(0, 300);
            if (!Object.keys(patch).length) throw new Error('Nada para salvar.');
            salvarCredenciais(arquivoCredenciais(config), rede, patch);
            if (rede === 'ia') aplicarChaveIa(arquivoCredenciais(config), process.env, { trocar: true });
            json(res, 200, statusApis(lerCredenciais(arquivoCredenciais(config))));
          } catch (e) { json(res, 400, { erro: e.message }); }
        });
        return;
      }
      const oauth = /^\/oauth\/(meta|youtube)(\/iniciar)?$/.exec(url.pathname);
      if (req.method === 'GET' && oauth) {
        if (!local(req)) return json(res, 403, { erro: 'Conecte pelo próprio Mac (localhost).' });
        const [rede, iniciar] = [oauth[1], !!oauth[2]];
        const file = arquivoCredenciais(config);
        const c = lerCredenciais(file);
        const redirect = `http://localhost:${config.portaPainel || 4321}/oauth/${rede}`;
        const voltar = (msg, ok) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#111;color:#eee;padding:24px"><h2 style="color:${ok ? '#FFE600' : '#f87171'}">${ok ? 'Conectado' : 'Não conectou'}</h2><p>${String(msg).replace(/[<>&]/g, '')}</p><p><a style="color:#FFE600" href="/#contas">Voltar para Contas</a></p>`); };
        if (iniciar) {
          if (rede === 'meta' && !(c.meta.appId && c.meta.appSecret)) return voltar('Cole antes a chave secreta do app da Meta na aba Contas.', false);
          if (rede === 'youtube' && !(c.youtube.clientId && c.youtube.clientSecret)) return voltar('Cole antes a chave secreta do cliente do Google na aba Contas.', false);
          const state = novoEstado(rede);
          res.writeHead(302, { location: rede === 'meta' ? metaApi.urlLogin({ ...c.meta, redirect, state }) : ytApi.urlLogin({ ...c.youtube, redirect, state }) });
          return res.end();
        }
        if (!usarEstado(url.searchParams.get('state'), rede)) return voltar('O pedido expirou ou não saiu daqui. Clique em Conectar de novo.', false);
        if (!url.searchParams.get('code')) return voltar(`Autorização cancelada (${url.searchParams.get('error_description') || url.searchParams.get('error') || 'sem código'}).`, false);
        const code = url.searchParams.get('code');
        const feito = rede === 'meta' ? metaApi.conectar({ ...c.meta, redirect, code }) : ytApi.conectar({ ...c.youtube, redirect, code });
        feito.then((r) => {
          salvarCredenciais(file, rede, { ...r, erro: null });
          registrar(config.pastaSaida, 'agendador', 'pronto', rede === 'meta' ? `Meta conectada: Página ${r.pageName}${r.igUsername ? ` e @${r.igUsername}` : ' (sem Instagram ligado!)'}` : `YouTube conectado: ${r.channelTitle}`);
          voltar(rede === 'meta' ? `Página ${r.pageName}${r.igUsername ? ` e Instagram @${r.igUsername}` : '. O Instagram não veio: ligue o Instagram à Página e conecte de novo'}.` : `Canal ${r.channelTitle}.`, true);
        }, (e) => voltar(e.message, false));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/contas') return json(res, 200, lerContas(config));
      if (req.method === 'POST' && url.pathname === '/api/contas') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e4) req.destroy(); });
        req.on('end', () => { try { json(res, 200, salvarConta(config, JSON.parse(body || '{}'))); } catch (e) { json(res, 400, { erro: e.message }); } });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/corte') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => { try { json(res, 200, editarCorte(config.pastaSaida, JSON.parse(body || '{}'), linhasDe(config))); } catch (e) { json(res, 400, { erro: e.message }); } });
        return;
      }
      // video and cover of a delivered post (the schedule shows them)
      const pr = /^\/pronto\/([^/]+)\/([^/]+)\/(video\.mp4|capa\.jpg)$/.exec(url.pathname);
      if (req.method === 'GET' && pr) {
        const [l, p, f] = [decodeURIComponent(pr[1]), decodeURIComponent(pr[2]), pr[3]];
        const file = path.join(config.pastaEntrega || '', l, p, f);
        if (!nomeSeguro(l) || !nomeSeguro(p) || !config.pastaEntrega || !fs.existsSync(file)) return json(res, 404, { erro: 'Não encontrado.' });
        return servirArquivo(req, res, file);
      }
      if (req.method === 'POST' && url.pathname === '/api/metricas/atualizar') {
        coletarMetricas(config).then((m) => json(res, 200, { atualizadoEm: m.atualizadoEm, erros: m.erros }), (e) => json(res, 500, { erro: e.message }));
        return;
      }
      const mid = /^\/midia\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && mid) {
        const [pasta, arquivo] = [decodeURIComponent(mid[1]), decodeURIComponent(mid[2])];
        const file = path.join(config.pastaSaida, pasta, arquivo);
        if (!nomeSeguro(pasta) || !caminhoSeguro(arquivo) || !MIME[path.extname(arquivo)] || !fs.existsSync(file)) return json(res, 404, { erro: 'Não encontrado.' });
        return servirArquivo(req, res, file);
      }
      json(res, 404, { erro: 'Não encontrado.' });
    } catch (e) { json(res, 500, { erro: e.message }); }
  });
}

export function enderecosLocais(porta) {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${porta}`);
}
