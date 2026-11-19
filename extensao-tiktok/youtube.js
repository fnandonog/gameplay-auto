// Postar no YouTube Studio (studio.youtube.com), em passos curtos injetados pelo background.js, igual ao studio.js do
// TikTok. Serve para o que passa da cota da API do YouTube (a central escolhe: src/youtubeChrome.js).
// A página de envio do Studio (2026, pt-BR):
//   - https://www.youtube.com/upload abre o Studio do canal logado com a caixa de envio aberta;
//   - input[type=file][name=Filedata] recebe o vídeo; depois aparecem o título e a descrição, que são caixas
//     contenteditable dentro de #title-textarea e #description-textarea (o título começa com o nome do arquivo);
//   - capa: input[type=file] de imagem dentro do editor de miniatura (#file-loader), quando o canal pode usar capa;
//   - "Não é conteúdo para crianças": tp-yt-paper-radio-button[name=VIDEO_MADE_FOR_KIDS_NOT_MFK];
//   - #next-button (3 vezes: Detalhes → Elementos do vídeo → Verificações → Visibilidade), "Público":
//     tp-yt-paper-radio-button[name=PUBLIC], e #done-button (Publicar);
//   - o link do vídeo aparece no painel lateral (a[href*="youtu"]) assim que o envio começa;
//   - o envio só continua com a aba aberta: o Publicar só é clicado depois do "Envio concluído".
import { receberPedaco, anexarDosPedacos } from './studio.js';

export function estadoYoutube() {
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  const q = (s) => document.querySelector(s);
  const login = /accounts\.google\.com|ServiceLogin/.test(location.href);
  const input = q('input[type="file"][name="Filedata"]') || [...document.querySelectorAll('input[type="file"]')].find((i) => /video/.test(i.accept || ''));
  const titulo = [...document.querySelectorAll('#title-textarea [contenteditable="true"], #title-textarea #textbox')].find(visivel);
  const prog = q('ytcp-video-upload-progress');
  const progresso = (prog?.innerText || '').replace(/\s+/g, ' ').trim();
  const link = [...document.querySelectorAll('ytcp-uploads-dialog a[href*="youtu"], .video-url-fadeable a[href*="youtu"]')].map((a) => a.href).find((h) => /youtu\.be\/|youtube\.com\/(shorts|watch)/.test(h)) || null;
  const erro = (q('ytcp-uploads-dialog .error-area, .ytcp-uploads-dialog .error-message')?.innerText || '').trim();
  const limite = /limite diário|daily upload limit/i.test(document.body?.innerText || '');
  return { login, input: !!input, titulo: !!titulo, progresso, link, erro, limite, dialogo: !!q('ytcp-uploads-dialog'), passo: q('ytcp-uploads-dialog #step-badge-3[state="active"], ytcp-uploads-dialog [test-id="REVIEW"][state="active"]') ? 'visibilidade' : null };
}

// Onde clicar para digitar no título ou na descrição (centro da caixa, em pixels CSS)
export function alvoYoutube(qual) {
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  const sel = qual === 'descricao' ? '#description-textarea [contenteditable="true"], #description-textarea #textbox' : '#title-textarea [contenteditable="true"], #title-textarea #textbox';
  const el = [...document.querySelectorAll(sel)].find(visivel);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(r.width / 2, 160)), y: Math.round(r.y + Math.min(r.height / 2, 14)) };
}

export function lerTextoYoutube(qual) {
  const el = document.querySelector(qual === 'descricao' ? '#description-textarea #textbox, #description-textarea [contenteditable="true"]' : '#title-textarea #textbox, #title-textarea [contenteditable="true"]');
  return el ? { texto: el.innerText } : null;
}

export function marcarNaoInfantil() {
  const r = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]');
  r?.scrollIntoView({ block: 'center' });
  r?.click();
  return { ok: !!r };
}

export function clicarProximo() {
  const b = document.querySelector('ytcp-uploads-dialog #next-button');
  if (!b || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled')) return { ok: false };
  b.click();
  return { ok: true };
}

export function marcarPublico() {
  const r = document.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]');
  r?.click();
  return { ok: !!r, marcado: !!r && (r.hasAttribute('checked') || r.getAttribute('aria-checked') === 'true') };
}

export function clicarPublicar() {
  const b = document.querySelector('ytcp-uploads-dialog #done-button');
  if (!b || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('disabled')) return { ok: false };
  b.click();
  return { ok: true };
}

// depois de publicar: a caixa "Vídeo publicado" (com o link) ou "ainda processando"
export function depoisDePublicar() {
  const share = document.querySelector('ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog');
  const link = share ? [...share.querySelectorAll('a[href*="youtu"]')].map((a) => a.href)[0] || (share.querySelector('#share-url')?.innerText || '').trim() : null;
  const fechar = share?.querySelector('#close-button, #close-icon-button, ytcp-button[id="close-button"]');
  fechar?.click();
  return { saiu: !!share, link: link || null };
}

const enviado = (p) => /conclu[ií]d|complete|verifica|checks|process|SD|HD/i.test(p) && !/enviando|uploading|\d+\s?%/i.test(p);

// O post inteiro. executar(func, args); aba: clicar, apagarTudo, digitar, enter, pedacos(url) (o background baixa)
export async function postarYoutube(executar, aba, job, { espera = 1 } = {}) {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms * espera));
  const estado = async () => (await executar(estadoYoutube, [])) || {};
  let etapa = 'abrir o YouTube Studio', postou = false;
  const parar = (erro) => ({ ok: false, etapa, erro, postou });
  const esperar = async (ok, ms) => {
    const fim = Date.now() + ms * espera;
    for (;;) {
      const e = await estado();
      if (e.login || e.limite || ok(e)) return e;
      if (Date.now() > fim) return null;
      await dormir(1500);
    }
  };
  const anexar = async (url, seletor, nome, tipo) => {
    const pedacos = await aba.pedacos(url);
    for (let i = 0; i < pedacos.length; i++) {
      const r = await executar(receberPedaco, [i, pedacos.length, pedacos[i]]);
      if (!r || r.erro) return r || { erro: 'a página recarregou no meio do arquivo' };
    }
    return executar(anexarDosPedacos, [pedacos.length, seletor, nome, tipo]);
  };
  try {
    let e = await esperar((s) => s.input, 60000);
    if (!e) return parar('a caixa de envio do YouTube Studio não abriu');
    if (e.login) return { ...parar('não está logado no YouTube'), saiu: true };
    if (e.limite) return parar('o YouTube diz que o limite diário de envios foi atingido');

    etapa = 'anexar o vídeo';
    const a = await anexar(job.video, 'input[type="file"][name="Filedata"]', 'fnando.mp4', 'video/mp4');
    if (!a || a.erro) return parar(a?.erro || 'a página recarregou ao anexar');

    etapa = 'esperar a tela de detalhes';
    e = await esperar((s) => s.titulo, 90000);
    if (!e || !e.titulo) return parar(e?.limite ? 'limite diário de envios do YouTube' : 'a tela de detalhes não abriu');
    await dormir(2500);

    etapa = 'escrever o título';
    for (const [qual, texto] of [['titulo', job.titulo], ['descricao', job.descricao]]) {
      etapa = qual === 'titulo' ? 'escrever o título' : 'escrever a descrição';
      const p = await executar(alvoYoutube, [qual]);
      if (!p) return parar(`a caixa de ${qual === 'titulo' ? 'título' : 'descrição'} sumiu`);
      await aba.clicar(p.x, p.y);
      await dormir(300);
      await aba.apagarTudo();
      const linhas = String(texto || '').split('\n');
      for (let i = 0; i < linhas.length; i++) {
        if (i) await aba.enter();
        if (linhas[i]) await aba.digitar(linhas[i]);
        await dormir(120);
      }
      await dormir(500);
    }
    const lido = await executar(lerTextoYoutube, ['titulo']);
    if (!lido || !String(lido.texto || '').trim()) return parar('o título ficou vazio');

    if (job.capa) {
      etapa = 'colocar a capa';
      // a capa é opcional: canal sem verificação por telefone não tem o campo; segue sem ela
      await anexar(job.capa, '#file-loader, ytcp-thumbnails-compact-editor-uploader input[type="file"], input[type="file"][accept*="image"]', 'capa.jpg', 'image/jpeg').catch(() => null);
      await dormir(1500);
    }

    etapa = 'marcar que não é para crianças';
    const k = await executar(marcarNaoInfantil, []);
    if (!k?.ok) return parar('não achei "Não é conteúdo para crianças"');
    await dormir(800);

    etapa = 'avançar até a visibilidade';
    for (let i = 0; i < 3; i++) {
      let ok = false;
      for (let t = 0; t < 20 && !ok; t++) { ok = !!(await executar(clicarProximo, []))?.ok; if (!ok) await dormir(1500); }
      if (!ok) return parar(`o botão Próxima não respondeu (passo ${i + 1})`);
      await dormir(1800);
    }

    etapa = 'marcar Público';
    const pub = await executar(marcarPublico, []);
    if (!pub?.ok) return parar('não achei a opção Público');
    await dormir(800);

    etapa = 'esperar o envio terminar';
    e = await esperar((s) => enviado(s.progresso) || s.erro, 25 * 60000);
    if (!e) return parar('o envio não terminou em 25 minutos');
    if (e.erro) return parar(`o YouTube mostrou: ${e.erro.slice(0, 160)}`);
    const link = e.link;

    etapa = 'clicar em Publicar';
    let clicou = false;
    for (let t = 0; t < 15 && !clicou; t++) { clicou = !!(await executar(clicarPublicar, []))?.ok; if (!clicou) await dormir(2000); }
    if (!clicou) return parar('o botão Publicar não respondeu');
    postou = true;
    await dormir(4000);
    let fim = null;
    for (let t = 0; t < 10 && !fim?.saiu; t++) { fim = await executar(depoisDePublicar, []); if (!fim?.saiu) await dormir(2000); }
    return { ok: true, etapa: 'publicado', postou: true, link: fim?.link || link || null };
  } catch (err) {
    return parar(String(err?.message || err).slice(0, 240));
  }
}
