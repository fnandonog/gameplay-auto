// External SSD for the heavy files. With config.ssd.pasta (e.g. "/Volumes/FNANDO SSD/FNANDO") mounted:
//   - ~/Gameplay/inbox (where OBS and Source Record write) is a link to <ssd>/inbox, so recordings go straight to the SSD;
//   - processed recordings move to <ssd>/gravacoes.
// Without the SSD the link points to ~/Gameplay/inbox-interno, so OBS never loses a recording. The link only changes
// while nothing in the inbox is open (OBS not recording).
// Cleaning (the owner asked for it): once a cut is out on EVERY network of its line, its video files are deleted
// (the delivered video.mp4 and the cut's renders); covers, texts, links and numbers stay.
import fs from 'node:fs';
import path from 'node:path';
import { listarEntregues } from './postador.js';
import { listarSessoes } from './painel.js';
import { pastaDoCorte } from './entrega.js';
import { linhasDe, linhaDoCorte } from './canais.js';
import { registrar } from './atividade.js';

// rename across disks (internal → SSD) fails with EXDEV: copy, check the size, then remove the original
export function moverGravacao(de, para) {
  fs.mkdirSync(path.dirname(para), { recursive: true });
  try { fs.renameSync(de, para); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(de, para);
    if (fs.statSync(para).size !== fs.statSync(de).size) throw new Error(`cópia incompleta de ${path.basename(de)}`);
    fs.unlinkSync(de);
  }
}

// the SSD folder when its disk is mounted, else null
export function pastaSsd(config, existe = fs.existsSync) {
  const p = config.ssd?.pasta;
  if (!p || config.ssd?.ligado === false) return null;
  const vol = p.match(/^\/Volumes\/[^/]+/)?.[0];
  return (!vol || existe(vol)) ? p : null;
}

export function pastasDeGravacao(config, existe = fs.existsSync) {
  const ssd = pastaSsd(config, existe);
  return ssd ? { inbox: path.join(ssd, 'inbox'), gravacoes: path.join(ssd, 'gravacoes'), ssd: true }
    : { inbox: `${config.pastaEntrada}-interno`, gravacoes: config.pastaProcessados, ssd: false };
}

// keeps config.pastaEntrada as a link to the right place. aberto(file) → true while OBS writes it. Returns the target.
export async function ajustarInbox(config, { aberto = async () => false, log = () => {} } = {}) {
  if (!config.ssd?.pasta) return null;
  const alvo = pastasDeGravacao(config);
  fs.mkdirSync(alvo.inbox, { recursive: true });
  fs.mkdirSync(alvo.gravacoes, { recursive: true });
  const link = config.pastaEntrada;
  let atual = null, ehLink = false;
  try { ehLink = fs.lstatSync(link).isSymbolicLink(); atual = ehLink ? fs.readlinkSync(link) : link; } catch {}
  if (ehLink && atual === alvo.inbox) return alvo;
  // something being recorded in the current inbox: switch later
  let nomes = []; try { nomes = fs.readdirSync(link); } catch {}
  nomes = nomes.filter((n) => !n.startsWith('.')); // .DS_Store and exFAT's ._ files are held by Finder or VMs, not by OBS
  for (const n of nomes) if (await aberto(path.join(link, n))) return null;
  // recordings waiting in the old place go along (closed files only, checked above)
  for (const n of nomes) moverGravacao(path.join(link, n), path.join(alvo.inbox, n));
  if (atual && !ehLink) fs.renameSync(link, `${link}-antiga-${Date.now()}`); // the old real folder is kept aside, empty
  else if (ehLink) fs.unlinkSync(link);
  fs.symlinkSync(alvo.inbox, link);
  log(`Gravações do OBS agora vão para ${alvo.inbox}${alvo.ssd ? ' (SSD)' : ' (SSD desconectado)'}.`);
  return alvo;
}

// pure: is the post out on every network of its line?
export function postadoEmTudo(post = {}, postado = {}) {
  const redes = post.linha?.redes || [];
  if (!redes.length) return false;
  return redes.every((r) => postado.links?.[r] || postado.emRede?.[r]);
}

// deletes the video files of fully posted cuts, at least `esperaH` hours after the last network got it
export function limparPostados(config, { agora = Date.now(), esperaH = 2, log = () => {} } = {}) {
  if (config.limparPostados === false || !config.pastaEntrega) return { apagados: 0, bytes: 0 };
  const linhas = linhasDe(config);
  const sessoes = listarSessoes(config.pastaSaida);
  let apagados = 0, bytes = 0;
  const apagar = (f) => { try { bytes += fs.statSync(f).size; fs.unlinkSync(f); apagados++; } catch {} };
  for (const p of listarEntregues(config.pastaEntrega)) {
    if (p.postado.limpoEm || !postadoEmTudo(p.post, p.postado)) continue;
    const ultimo = Math.max(...Object.values(p.postado.emRede || {}).map((t) => Date.parse(t) || 0), Date.parse(p.postado.em) || 0);
    if (agora - ultimo < esperaH * 3600000) continue;
    // the cut in the session folder that was delivered here
    for (const s of sessoes) {
      const c = (s.cortes || []).find((x) => pastaDoCorte(config.pastaEntrega, { linha: linhaDoCorte(x, linhas), sessao: s.sessao || s.pasta, arquivo: x.arquivo }) === p.dir)
        || (s.longo && pastaDoCorte(config.pastaEntrega, { linha: { id: 'youtube-longo' }, sessao: s.sessao || s.pasta, arquivo: path.basename(s.longo.arquivo) }) === p.dir ? s.longo : null)
        || (s.missoes || []).find((m) => pastaDoCorte(config.pastaEntrega, { linha: { id: 'youtube-longo' }, sessao: s.sessao || s.pasta, arquivo: path.basename(m.arquivo) }) === p.dir);
      if (!c) continue;
      const dir = path.join(config.pastaSaida, s.pasta);
      const arquivos = new Set([c.arquivo, ...Object.values(c.variantes || {}), ...(c.versoes || []).map((v) => v.arquivo)].filter(Boolean));
      for (const a of arquivos) { apagar(path.join(dir, a)); apagar(path.join(dir, a.replace(/\.mp4$/, '.ass'))); }
      const file = path.join(dir, 'sessao.json');
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        const k = (j.cortes || []).find((x) => x.arquivo === c.arquivo) || (j.longo?.arquivo === c.arquivo ? j.longo : null) || (j.missoes || []).find((m) => m.arquivo === c.arquivo);
        if (k) { k.limpoEm = new Date(agora).toISOString(); fs.writeFileSync(file, JSON.stringify(j, null, 2)); }
      } catch {}
      break;
    }
    apagar(path.join(p.dir, 'video.mp4'));
    apagar(path.join(p.dir, 'video.antes-audio.mp4')); // the copy kept by tools/consertar-audio.mjs
    fs.writeFileSync(path.join(p.dir, 'postado.json'), JSON.stringify({ ...p.postado, limpoEm: new Date(agora).toISOString() }, null, 2));
  }
  if (apagados) {
    const mb = Math.round(bytes / 1048576);
    log(`Limpeza: ${apagados} arquivo(s) de cortes já postados em todas as redes (${mb} MB).`);
    registrar(config.pastaSaida, 'agendador', 'pronto', `Limpeza: ${mb} MB de cortes já postados`);
  }
  return { apagados, bytes };
}
