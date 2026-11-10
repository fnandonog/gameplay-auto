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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINA = path.join(ROOT, 'public', 'painel.html');
const ESCRITORIO = path.join(ROOT, 'public', 'escritorio.html');
const MARCA = path.join(ROOT, 'public', 'marca');
const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }; // only the cuts and their covers are served
export const STATUS = ['aguardando', 'aprovado', 'descartado', 'agendado', 'postado'];

// a name that came from the URL must be a plain file/folder name inside the output folder
export const nomeSeguro = (s) => typeof s === 'string' && s.length > 0 && s === path.basename(s) && !s.startsWith('.');

export function listarSessoes(pastaSaida) {
  if (!fs.existsSync(pastaSaida)) return [];
  return fs.readdirSync(pastaSaida)
    .filter((d) => fs.existsSync(path.join(pastaSaida, d, 'sessao.json')))
    .map((d) => ({ pasta: d, ...JSON.parse(fs.readFileSync(path.join(pastaSaida, d, 'sessao.json'), 'utf8')) }))
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

// applies an edit to one cut; returns the cut or throws
export function editarCorte(pastaSaida, { pasta, arquivo, ...mud }, linhas = null) {
  if (!nomeSeguro(pasta) || !nomeSeguro(arquivo)) throw new Error('Corte inválido.');
  const file = path.join(pastaSaida, pasta, 'sessao.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = s.cortes.find((x) => x.arquivo === arquivo) || (s.longo?.arquivo === arquivo ? s.longo : null);
  if (!c) throw new Error('Corte não encontrado.');
  if (mud.status !== undefined) { if (!STATUS.includes(mud.status)) throw new Error('Status inválido.'); c.status = mud.status; }
  if (mud.linha !== undefined) { if (linhas && !linhas.some((l) => l.id === mud.linha)) throw new Error('Linha inválida.'); c.linha = String(mud.linha); }
  if (typeof mud.titulo === 'string') c.titulo = mud.titulo.slice(0, 100);
  if (typeof mud.descricao === 'string') c.descricao = mud.descricao.slice(0, 5000);
  if (Array.isArray(mud.hashtags)) c.hashtags = mud.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 10);
  c.atualizadoEm = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  return c;
}

function servirArquivo(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) { res.writeHead(200, { 'content-type': type, 'content-length': stat.size, 'accept-ranges': 'bytes' }); return fs.createReadStream(file).pipe(res); }
  const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
  if (start >= stat.size) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }); return res.end(); }
  res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' });
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
      if (!autorizado(req)) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Abra o endereço com ?senha=...'); }
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return fs.createReadStream(PAGINA).pipe(res); }
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
      if (req.method === 'POST' && url.pathname === '/api/corte') {
        let body = '';
        req.on('data', (d) => { body += d; if (body.length > 1e5) req.destroy(); });
        req.on('end', () => { try { json(res, 200, editarCorte(config.pastaSaida, JSON.parse(body || '{}'), linhasDe(config))); } catch (e) { json(res, 400, { erro: e.message }); } });
        return;
      }
      const mid = /^\/midia\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && mid) {
        const [pasta, arquivo] = [decodeURIComponent(mid[1]), decodeURIComponent(mid[2])];
        const file = path.join(config.pastaSaida, pasta, arquivo);
        if (!nomeSeguro(pasta) || !nomeSeguro(arquivo) || !MIME[path.extname(arquivo)] || !fs.existsSync(file)) return json(res, 404, { erro: 'Não encontrado.' });
        return servirArquivo(req, res, file);
      }
      json(res, 404, { erro: 'Não encontrado.' });
    } catch (e) { json(res, 500, { erro: e.message }); }
  });
}

export function enderecosLocais(porta) {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${porta}`);
}
