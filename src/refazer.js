// "Pedir ajuste" and the quick edit of a cut on the panel. The owner writes what to change (kept in sessao.json for
// the next look) or picks options that the central can apply alone: with or without the camera, the channel @ on
// screen, the "SEGUE @" card at the end and a game tag ("GTA 6", "EA FC", plain text in the channel font, never the
// game's logo). A redo renders a NEW file next to the old one (nothing is deleted) and the cut goes back to review.
import fs from 'node:fs';
import path from 'node:path';
import { palavrasEntre } from './transcricao.js';
import { renderCorte, capa, FORMATOS } from './corte.js';
import { marcaDaLinha } from './marca.js';
import { linhasDe } from './canais.js';
import { registrar } from './atividade.js';

// pure: the edit the owner picked, cleaned (unknown keys dropped)
export function limparEdicao(e = {}) {
  const out = {};
  if (typeof e.formato === 'string' && FORMATOS[e.formato]) out.formato = e.formato;
  if (typeof e.arroba === 'boolean') out.arroba = e.arroba;
  if (typeof e.chamada === 'boolean') out.chamada = e.chamada;
  if (typeof e.selo === 'string') out.selo = e.selo.replace(/[{}\\]/g, '').trim().slice(0, 24);
  if (typeof e.musica === 'boolean') out.musica = e.musica;
  if (typeof e.legenda === 'boolean') out.legenda = e.legenda;
  return out;
}

// pure: what the render gets for this edit
export function opcoesDaEdicao(c = {}, edicao = {}, marca = null) {
  const formato = edicao.formato || c.formato || 'meio';
  let m = marca ? { ...marca } : null;
  if (m && edicao.arroba === false) m.arroba = '';
  if (m && edicao.chamada === false) m.chamada = false;
  const selo = edicao.selo != null ? edicao.selo.toUpperCase() : (c.parte ? `PARTE ${c.parte}` : '');
  return { formato, marca: m, selo };
}

// pure: a file name that does not exist yet (01-x-meio.mp4 → 01-x-meio-v2.mp4, -v3...)
export function nomeVersao(arquivo, formato, existe = () => false) {
  const base = String(arquivo).replace(/\.mp4$/, '').replace(/-(meio|camtopo|jogo|jogocheio)(-v\d+)?$/, '');
  for (let v = 2; v < 100; v++) {
    const nome = `${base}-${formato}-v${v}.mp4`;
    if (!existe(nome)) return nome;
  }
  throw new Error('Versões demais deste corte.');
}

const acharCorte = (s, arquivo) => s.cortes.find((x) => x.arquivo === arquivo || Object.values(x.variantes || {}).includes(arquivo));

// writes the owner's note; status 'ajuste' keeps it out of posting until it is redone or approved
export function pedirAjuste(pastaSaida, { pasta, arquivo, texto }, agora = new Date().toISOString()) {
  const file = path.join(pastaSaida, pasta, 'sessao.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = acharCorte(s, arquivo) || (s.longo?.arquivo === arquivo ? s.longo : null) || (s.missoes || []).find((x) => x.arquivo === arquivo);
  if (!c) throw new Error('Corte não encontrado.');
  const t = String(texto || '').trim().slice(0, 2000);
  if (!t) throw new Error('Escreva o que precisa mudar.');
  c.ajustes = [...(c.ajustes || []), { texto: t, em: agora, feito: false }];
  c.status = 'ajuste';
  c.atualizadoEm = agora;
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  registrar(pastaSaida, 'editor', 'pronto', `Ajuste pedido: ${c.titulo || arquivo}`);
  return c;
}

let fila = Promise.resolve();
// renders the cut again with the edit; returns at once, the work runs in a queue (one ffmpeg at a time)
export function refazerCorte(config, { pasta, arquivo, edicao }, { render = renderCorte, fazerCapa = capa, log = console.log } = {}) {
  const dir = path.join(config.pastaSaida, pasta);
  const file = path.join(dir, 'sessao.json');
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = acharCorte(s, arquivo);
  if (!c) throw new Error('Só dá para refazer os Shorts por aqui.');
  if (c.refazendo) throw new Error('Este corte já está sendo refeito.');
  const ed = limparEdicao(edicao);
  if (ed.formato && !FORMATOS[ed.formato].semCamera && s.camera === s.jogo && !config.regiaoCamera) throw new Error('Esta gravação não tem câmera.');
  c.refazendo = true; c.edicao = ed;
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  registrar(config.pastaSaida, 'editor', 'trabalhando', `Refazendo: ${c.titulo || arquivo}`);
  const tarefa = async () => {
    const atual = JSON.parse(fs.readFileSync(file, 'utf8'));
    const k = acharCorte(atual, arquivo);
    try {
      let words = [];
      try { words = JSON.parse(fs.readFileSync(path.join(dir, 'transcricao.json'), 'utf8')); } catch {}
      const linha = linhasDe(config).find((l) => l.id === k.linha) || linhasDe(config)[0];
      const op = opcoesDaEdicao(k, ed, marcaDaLinha(linha, config));
      const nome = nomeVersao(k.variantes?.[op.formato] || k.arquivo, op.formato, (n) => fs.existsSync(path.join(dir, n)));
      const out = path.join(dir, nome);
      const cfg = { ...config, ...(k.obrigatorio ? { cortarSilencio: false } : {}), ...(ed.musica === false ? { musica: { ...config.musica, ligado: false } } : {}) };
      const palavras = ed.legenda === false ? [] : palavrasEntre(words, k.inicio, k.fim);
      await render({ jogo: atual.jogo || atual.gravacao, camera: atual.camera || atual.gravacao, audio: atual.gravacao, start: k.inicio, end: k.fim, palavras, gancho: k.gancho, selo: op.selo, out, formato: op.formato, marca: op.marca, config: cfg });
      await fazerCapa(out, out.replace(/\.mp4$/, '.jpg'), Math.min(k.fim - k.inicio - 0.5, (k.fim - k.inicio) * 0.4)).catch(() => null);
      k.versoes = [...(k.versoes || []), { arquivo: k.arquivo, formato: k.formato, em: new Date().toISOString() }];
      k.variantes = { ...(k.variantes || {}), [op.formato]: nome };
      k.formato = op.formato; k.arquivo = nome;
      if (fs.existsSync(out.replace(/\.mp4$/, '.jpg'))) k.capa = nome.replace(/\.mp4$/, '.jpg');
      for (const a of k.ajustes || []) a.feito = true;
      k.status = 'aguardando';
      delete k.erroRefazer;
      registrar(config.pastaSaida, 'editor', 'pronto', `Refeito: ${k.titulo || arquivo}`);
    } catch (e) {
      k.erroRefazer = String(e.message || e).slice(0, 300);
      log(`Refazer falhou: ${k.erroRefazer}`);
      registrar(config.pastaSaida, 'editor', 'erro', `Refazer falhou: ${k.erroRefazer}`);
    } finally {
      delete k.refazendo;
      k.atualizadoEm = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(atual, null, 2));
    }
  };
  fila = fila.then(tarefa, tarefa);
  return { ok: true, refazendo: true, fila };
}
