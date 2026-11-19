// The central: one page to follow everything the platform does. Raw recordings coming in (OBS folder or uploaded from
// the browser), scripts and ideas, cuts waiting for approval, cuts delivered to the owner's posting skill, and the
// numbers of each social account. Everything here only reads folders; the numbers come from a metricas.json that the
// owner's skill (or anyone) writes, so the central works before any account is connected.
import fs from 'node:fs';
import path from 'node:path';
import { listarSessoes } from './painel.js';
import { linhasDe } from './canais.js';
import { lerAtividade } from './atividade.js';
import { horariosSeguros, capacidadeDiaria, LIMITES_SEGUROS } from './canais.js';
import { run } from './run.js';

export const VIDEO = /\.(mp4|mkv|mov)$/i;
const ROTEIRO = /\.(md|txt|json)$/i;
export const REDES = ['youtube', 'tiktok', 'instagram', 'facebook', 'twitch'];

const stat = (f) => { try { return fs.statSync(f); } catch { return null; } };
const lerJson = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
const dir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

// name of the session folder made from a recording (same rule as processarSessao)
export const pastaDaGravacao = (nome) => nome.replace(VIDEO, '').replace(/[^\w -]/g, '');

// Raw recordings: the ones still in the OBS folder ("na fila" or "gravando" while the file grows) and the ones already
// processed (moved to pastaProcessados). Each one says how many cuts it gave.
export function listarBrutos(config, { agora = Date.now() } = {}) {
  const sessoes = new Map(listarSessoes(config.pastaSaida).map((s) => [s.pasta, s]));
  const vigia = lerAtividade(config.pastaSaida).agentes?.vigia;
  const item = (pasta, nome, onde) => {
    const st = stat(path.join(pasta, nome));
    if (!st || !st.isFile()) return null;
    const s = sessoes.get(pastaDaGravacao(nome));
    let status = onde === 'inbox' ? 'na fila' : 'processado';
    if (onde === 'inbox' && agora - st.mtimeMs < 30000) status = 'gravando';
    if (onde === 'inbox' && vigia?.estado === 'trabalhando' && String(vigia.texto).includes(nome)) status = 'processando';
    if (s) status = 'processado';
    return {
      nome, onde, bytes: st.size, modificadoEm: new Date(st.mtimeMs).toISOString(), status,
      sessao: s ? s.pasta : null, cortes: s ? s.cortes.length : 0, longo: !!s?.longo, duracao: s?.duracao ?? null,
    };
  };
  const lista = [
    ...dir(config.pastaEntrada).filter((f) => VIDEO.test(f) && !f.startsWith('.')).map((f) => item(config.pastaEntrada, f, 'inbox')),
    ...dir(config.pastaProcessados).filter((f) => VIDEO.test(f) && !f.startsWith('.')).map((f) => item(config.pastaProcessados, f, 'gravacoes')),
  ].filter(Boolean);
  return lista.sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm));
}

// Scripts and ideas: text files in pastaRoteiros (default ~/Gameplay/roteiros). A .json may be
// { titulo, tipo: 'short' | 'longo' | 'live', status, texto } ; .md/.txt use the first line as the title.
export function listarRoteiros(config) {
  const base = config.pastaRoteiros;
  if (!base) return [];
  return dir(base).filter((f) => ROTEIRO.test(f) && !f.startsWith('.')).map((f) => {
    const file = path.join(base, f);
    const st = stat(file);
    if (!st?.isFile() || st.size > 200000) return null;
    const bruto = fs.readFileSync(file, 'utf8');
    let r = { titulo: '', tipo: 'ideia', status: 'rascunho', texto: bruto };
    if (/\.json$/i.test(f)) { const j = lerJson(file, {}); r = { ...r, ...j, texto: String(j.texto ?? '') }; }
    else r.titulo = bruto.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || f;
    return { arquivo: f, ...r, modificadoEm: new Date(st.mtimeMs).toISOString() };
  }).filter(Boolean).sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm));
}

// Cuts delivered to the posting skill (pastaEntrega/<linha>/<pasta>/post.json). The skill marks a post as done by
// writing "postado.json" ({ em, links: { tiktok: 'https://...' } }) next to it, or "postadoEm" inside post.json.
export function listarProntos(config) {
  const base = config.pastaEntrega;
  if (!base) return [];
  const out = [];
  for (const linha of dir(base).filter((d) => !d.startsWith('.'))) {
    for (const p of dir(path.join(base, linha)).filter((d) => !d.startsWith('.'))) {
      const pasta = path.join(base, linha, p);
      const post = lerJson(path.join(pasta, 'post.json'));
      if (!post) continue;
      const feito = lerJson(path.join(pasta, 'postado.json'));
      out.push({
        linha, pasta: p, titulo: post.titulo, gancho: post.gancho, duracao: post.duracao, redes: post.linha?.redes || [],
        criadoEm: post.criadoEm, agendarPara: post.agendarPara || null, status: feito || post.postadoEm ? 'postado' : 'esperando a postagem',
        postadoEm: feito?.em || post.postadoEm || null, links: feito?.links || post.links || {},
      });
    }
  }
  return out.sort((a, b) => String(a.agendarPara || a.criadoEm).localeCompare(String(b.agendarPara || b.criadoEm)));
}

// Numbers of each account. metricas.json (in the Gameplay folder by default):
// { atualizadoEm, contas: [{ rede, arroba, nome, seguidores, views7d, curtidas7d, posts, link }],
//   historico: [{ dia: '2026-11-19', seguidores: 120, views: 3400 }] }
// Without the file, the accounts planned in `linhas` show up as "não conectada".
export function lerRedes(config) {
  const m = lerJson(config.arquivoMetricas, null);
  const planejadas = [];
  for (const l of linhasDe(config)) for (const rede of l.redes || []) planejadas.push({ rede, linha: l.id, nome: l.nome, arroba: l.arroba || '' });
  const contas = (m?.contas || []).filter((c) => c && REDES.includes(c.rede));
  const conectadas = new Set(contas.map((c) => `${c.rede}|${c.nome || ''}`));
  const faltam = planejadas.filter((p) => !conectadas.has(`${p.rede}|${p.nome}`) && !contas.some((c) => c.rede === p.rede && c.linha === p.linha))
    .map((p) => ({ ...p, conectada: false }));
  const soma = (k) => contas.reduce((t, c) => t + (Number(c[k]) || 0), 0);
  return {
    atualizadoEm: m?.atualizadoEm || null,
    contas: [...contas.map((c) => ({ ...c, conectada: true })), ...faltam],
    total: { seguidores: soma('seguidores'), views7d: soma('views7d'), curtidas7d: soma('curtidas7d'), posts: soma('posts') },
    historico: Array.isArray(m?.historico) ? m.historico.slice(-60) : [],
  };
}

// Counts for the home tab (pure over the lists above)
export function resumo({ brutos = [], sessoes = [], roteiros = [], prontos = [], redes = null }) {
  const cortes = sessoes.flatMap((s) => s.cortes || []);
  const por = (st) => cortes.filter((c) => c.status === st).length;
  return {
    brutosNaFila: brutos.filter((b) => b.onde === 'inbox' && b.status !== 'processado').length,
    brutos: brutos.length,
    cortes: cortes.length,
    aguardando: por('aguardando'),
    aprovados: por('aprovado'),
    longos: sessoes.reduce((n, s) => n + (s.longo ? 1 : 0) + (s.missoes || []).length, 0),
    roteiros: roteiros.length,
    prontos: prontos.filter((p) => p.status !== 'postado').length,
    postados: prontos.filter((p) => p.status === 'postado').length + por('postado'),
    seguidores: redes?.total?.seguidores || 0,
    views7d: redes?.total?.views7d || 0,
  };
}

// Upload from the browser: the file goes straight into the OBS folder, so the watcher treats it like a recording.
// Only a plain video file name passes; an existing name gets " (2)", " (3)"...
export function nomeDeEnvio(nome, existentes = []) {
  const base = path.basename(String(nome || '')).replace(/[^\p{L}\p{N} ._()-]/gu, '').trim();
  if (!base || base.startsWith('.') || !VIDEO.test(base)) return null;
  const ext = path.extname(base), raiz = base.slice(0, -ext.length);
  let n = base, i = 2;
  while (existentes.includes(n)) n = `${raiz} (${i++})${ext}`;
  return n;
}

export function receberEnvio(req, config, nome, { limite = 20 * 2 ** 30 } = {}) {
  return new Promise((ok, fail) => {
    fs.mkdirSync(config.pastaEntrada, { recursive: true });
    const final = nomeDeEnvio(nome, dir(config.pastaEntrada));
    if (!final) return fail(new Error('Mande um vídeo .mp4, .mov ou .mkv.'));
    // written under a hidden name and renamed at the end, so the watcher never takes a half file
    const tmp = path.join(config.pastaEntrada, `.envio-${Date.now()}-${final}`);
    const out = fs.createWriteStream(tmp);
    let bytes = 0, erro = null;
    req.on('data', (d) => { bytes += d.length; if (bytes > limite && !erro) { erro = new Error('Arquivo grande demais.'); req.destroy(); } });
    req.on('error', (e) => { erro = erro || e; out.destroy(); });
    req.on('aborted', () => { erro = erro || new Error('Envio interrompido.'); out.destroy(); });
    req.pipe(out);
    out.on('close', () => {
      if (erro || !bytes) { fs.rmSync(tmp, { force: true }); return fail(erro || new Error('Arquivo vazio.')); }
      fs.renameSync(tmp, path.join(config.pastaEntrada, final));
      ok({ nome: final, bytes });
    });
    out.on('error', (e) => { fs.rmSync(tmp, { force: true }); fail(e); });
  });
}

// What is still missing before the accounts go live, in plain words. Each item: { id, ok, titulo, comoFazer, dono }
// (dono: 'voce' = something only the owner can do; 'plataforma' = a setting here). `checar` runs the tools (tests stub it).
export const ARROBAS_PALPITE = new Set(['@fnando', '@fnandoshorts', '@fnandoresenha', '@fnandodicas', '@clipai']);
export async function prontidao(config, { checar = (cmd, args) => run(cmd, args, { timeoutMs: 10000 }).then(() => true, () => false), env = process.env } = {}) {
  const linhas = linhasDe(config);
  const existe = (f) => !!f && fs.existsSync(f);
  const arrobas = linhas.map((l) => l.arroba || config.marca?.arroba || '').filter(Boolean);
  const metricas = lerJson(config.arquivoMetricas, null);
  const conectadas = new Set((metricas?.contas || []).map((c) => c.rede));
  const redes = [...new Set(linhas.flatMap((l) => l.redes || []))];
  const itens = [
    { id: 'ffmpeg', ok: await checar('ffmpeg', ['-version']), titulo: 'ffmpeg instalado no Mac', comoFazer: 'No Terminal: brew install ffmpeg', dono: 'plataforma' },
    { id: 'whisper', ok: (await checar(config.whisper?.bin || 'whisper-cli', ['--help'])) && existe(config.whisper?.modelo), titulo: 'Transcrição (whisper) instalada com o modelo', comoFazer: 'No Terminal: sh tools/instalar-mac.sh', dono: 'plataforma' },
    { id: 'ia', ok: !!env.ANTHROPIC_API_KEY || existe(path.join(process.env.HOME || '', '.config', 'ant')), titulo: 'IA para escolher os cortes e escrever títulos', comoFazer: 'Ponha ANTHROPIC_API_KEY no ~/.zshrc (ou rode: ant auth login). Sem ela os títulos saem genéricos.', dono: 'voce' },
    { id: 'obs', ok: existe(config.pastaEntrada) && (dir(config.pastaEntrada).some((f) => VIDEO.test(f)) || dir(config.pastaProcessados).some((f) => VIDEO.test(f))), titulo: 'OBS gravando na pasta certa', comoFazer: `Configurações do OBS > Saída > Gravação: caminho ${config.pastaEntrada}`, dono: 'plataforma' },
    { id: 'nome', ok: arrobas.length > 0 && arrobas.every((a) => !ARROBAS_PALPITE.has(a.toLowerCase())), titulo: 'Nome e @ do canal escolhidos', comoFazer: 'Escolha o nome (anônimo) e me diga o @ de cada rede. Ele vai escrito no fim de cada corte ("SEGUE @...").', dono: 'voce' },
    ...redes.map((r) => ({ id: `conta-${r}`, ok: conectadas.has(r), titulo: `Conta no ${{ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[r] || r} criada e conectada`, comoFazer: 'Crie a conta (e-mail novo, sem seu telefone pessoal) e conecte na sua skill de postagem; ela passa a escrever metricas.json.', dono: 'voce' })),
    config.postagem === 'upload-post'
      ? { id: 'postagem', ok: !!env.UPLOAD_POST_API_KEY && linhas.every((l) => l.perfil), titulo: 'Upload-Post com chave e perfis', comoFazer: 'export UPLOAD_POST_API_KEY=... e o perfil de cada linha no config.json', dono: 'voce' }
      : { id: 'postagem', ok: existe(config.pastaEntrega), titulo: 'Skill de postagem lendo a pasta de prontos', comoFazer: `Aponte sua skill de autopost para ${config.pastaEntrega} (cada pasta tem video.mp4, capa.jpg e post.json com legenda, hashtags e horário).`, dono: 'voce' },
    { id: 'limites', ok: linhas.every((l) => (l.horarios || []).length <= horariosSeguros(l, config.limites).length), titulo: 'Volume por conta dentro do limite seguro', comoFazer: `Máximo por conta por dia: ${Object.entries({ ...LIMITES_SEGUROS, ...(config.limites || {}) }).map(([r, n]) => `${r} ${n}`).join(', ')}. Para postar mais, crie mais contas (linhas).`, dono: 'plataforma' },
  ];
  return { itens, faltam: itens.filter((i) => !i.ok).length, capacidadeDia: capacidadeDiaria(linhas, config.limites) };
}
