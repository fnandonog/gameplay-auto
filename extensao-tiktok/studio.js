// Postar na página de envio do TikTok Studio (tiktok.com/tiktokstudio/upload), em passos curtos. Cada passo é uma função
// pequena e autossuficiente que o background.js injeta com chrome.scripting.executeScript (o Chrome manda o código da
// função, não os imports); um passo cuja página sumiu responde null e é pedido de novo.
// Veio da extensão do projeto Afiliado (testada na página de verdade em 27/10/2026, em pt-BR), igual na do FNANDO:
//   - a legenda é um editor Draft.js com sugestões de hashtag. Texto posto por script (execCommand, colar sintético)
//     duplica as hashtags e quebra a página ("Algo deu errado"), e o rascunho quebrado fica guardado no navegador
//     (IndexedDB web_creation_draft) e volta toda vez que a página abre. Por isso a legenda é digitada com teclas de
//     verdade (chrome.debugger Input.insertText no background.js, o `aba` abaixo), que o editor aceita como de uma pessoa;
//   - um rascunho deixado aberto também volta: é descartado antes (Descartar);
//   - avisos aparecem sobre o formulário ("Ativar verificações automáticas de conteúdo?": Cancelar; dicas: Entendi);
//   - input[type=file][accept="video/*"], button[data-e2e="post_video_button"] com aria-disabled até o vídeo subir,
//     "Falha no carregamento" quando o envio falha.
// test/social-tiktok-chrome.test.js roda `postar` no Chromium contra uma página com o mesmo formato.

// O que a página mostra agora.
export function estadoStudio() {
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  const texto = document.body?.innerText || '';
  const b = document.querySelector('button[data-e2e="post_video_button"]');
  const editor = [...document.querySelectorAll('.public-DraftEditor-content, [contenteditable="true"]')].find(visivel);
  return {
    login: /\/login/.test(location.pathname),
    quebrou: /algo deu errado|something went wrong/i.test(texto) && !editor,
    input: !!document.querySelector('input[type="file"]'),
    editor: !!editor,
    pronto: visivel(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.getAttribute('data-disabled') !== 'true',
    falhou: /falha no carregamento|upload failed|não foi possível carregar/i.test(texto),
    agora: [...document.querySelectorAll('button, [role="button"]')].some((x) => visivel(x) && /^(Publicar agora|Postar agora|Post now)$/i.test(x.textContent.trim())),
    publicado: /\/tiktokstudio\/content/.test(location.pathname)
      || /(seu vídeo (foi|está sendo) (publicado|enviado)|vídeo publicado|your video (has been|is being) (uploaded|posted)|manage your posts|gerenciar (suas )?publicações)/i.test(texto),
  };
}

// Fecha o que o TikTok põe sobre o formulário: a oferta de verificações automáticas (Cancelar, nada muda na conta) e dicas.
export function fecharAvisos() {
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  let n = 0;
  for (const d of document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="Modal"]')) {
    if (!visivel(d) || !/verificaç(ões|ao) automátic|automatic content check/i.test(d.innerText || '')) continue;
    const b = [...d.querySelectorAll('button')].find((x) => /^(Cancelar|Cancel)$/i.test(x.textContent.trim()));
    if (b) { b.click(); n++; }
  }
  for (const b of document.querySelectorAll('button')) {
    if (visivel(b) && /^(Entendi|Got it)$/i.test(b.textContent.trim())) { b.click(); n++; }
  }
  return { n };
}

// Um rascunho aberto na página (um post que não foi): Descartar e confirmar.
export async function descartarRascunho() {
  const b = document.querySelector('button[data-e2e="discard_post_button"]');
  if (!b) return { ok: false };
  b.click();
  await new Promise((r) => setTimeout(r, 1200));
  const confirma = [...document.querySelectorAll('button')].filter((x) => x.getClientRects().length > 0 && /^(Descartar|Discard)$/i.test(x.textContent.trim())).pop();
  if (confirma && confirma !== b) confirma.click();
  return { ok: true };
}

// A página quebrou num rascunho estragado: apaga os rascunhos guardados no navegador para ela abrir limpa da próxima vez.
export async function limparRascunhos() {
  const db = await new Promise((ok, falha) => { const r = indexedDB.open('web_creation_draft'); r.onsuccess = () => ok(r.result); r.onerror = falha; });
  const lojas = [...db.objectStoreNames].filter((n) => /^(local_draft|resource)_/.test(n));
  for (const st of lojas) await new Promise((ok) => { const t = db.transaction(st, 'readwrite'); t.objectStore(st).clear(); t.oncomplete = ok; t.onerror = ok; });
  db.close();
  return { ok: true, lojas: lojas.length };
}

// Baixa o vídeo do painel (CORS para www.tiktok.com) e anexa. O Chrome novo pede permissão de "rede local" para a página
// do TikTok falar com localhost, e sem ela o fetch falha: por isso o background.js baixa e manda em pedaços (abaixo).
export async function anexarVideo(url) {
  let blob;
  try {
    const r = await fetch(url, { credentials: 'omit' });
    if (!r.ok) return { erro: `o painel respondeu ${r.status} ao baixar o vídeo` };
    blob = await r.blob();
  } catch (e) { return { erro: `a página não conseguiu baixar o vídeo da central (${String(e.message || e).slice(0, 80)})`, rede: true }; }
  const input = document.querySelector('input[type="file"][accept*="video"]') || document.querySelector('input[type="file"]');
  if (!input) return { erro: 'o campo de enviar arquivo sumiu' };
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'fnando.mp4', { type: 'video/mp4' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, bytes: blob.size };
}

// O vídeo baixado pelo background chega em pedaços base64 (cada executeScript leva poucos MB).
export function receberPedaco(i, total, b64) {
  if (i === 0) window.__fnandoVideo = [];
  const lista = window.__fnandoVideo;
  if (!lista) return { erro: 'a página recarregou no meio do vídeo' };
  lista[i] = b64;
  return { ok: true, tem: lista.filter(Boolean).length, total };
}
export function anexarDosPedacos(total, seletor = 'input[type="file"][accept*="video"]', nome = 'fnando.mp4', tipo = 'video/mp4') {
  const lista = window.__fnandoVideo || [];
  if (lista.filter(Boolean).length !== total) return { erro: 'a página recarregou no meio do vídeo' };
  const partes = lista.map((b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); return u; });
  window.__fnandoVideo = null;
  const input = document.querySelector(seletor) || (tipo.startsWith('video') ? document.querySelector('input[type="file"]') : null);
  if (!input) return { erro: 'o campo de enviar arquivo sumiu' };
  const file = new File(partes, nome, { type: tipo });
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, bytes: file.size };
}

// Onde clicar: o editor da legenda ou o botão Publicar, trazido para a vista (centro, em pixels CSS).
export function alvo(qual) {
  const visivel = (el) => !!el && el.getClientRects().length > 0;
  const el = qual === 'publicar' ? document.querySelector('button[data-e2e="post_video_button"]')
    : [...document.querySelectorAll('.public-DraftEditor-content, [contenteditable="true"]')].find(visivel);
  if (!visivel(el)) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(r.width / 2, 120)), y: Math.round(r.y + Math.min(r.height / 2, 14)) };
}

export function lerLegenda() {
  const ed = [...document.querySelectorAll('.public-DraftEditor-content, [contenteditable="true"]')].find((el) => el.getClientRects().length > 0);
  return ed ? { texto: ed.innerText } : null;
}

export function clicarPublicarAgora() {
  const b = [...document.querySelectorAll('button, [role="button"]')].find((x) => x.getClientRects().length > 0 && /^(Publicar agora|Postar agora|Post now)$/i.test(x.textContent.trim()));
  b?.click();
  return { ok: !!b };
}

// A legenda como teclas: um insertText por linha e Enter entre elas. Linha que termina em #hashtag ou @menção ganha um
// espaço antes, para o Enter não escolher um item da lista de sugestões.
export function linhasDaLegenda(texto) {
  return String(texto || '').replace(/\r/g, '').slice(0, 2200).split('\n').map((l) => (/(^|\s)[#@][^\s#@]+$/.test(l) ? `${l} ` : l));
}
const igual = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();

// O post inteiro.
// executar(func, args): roda um passo na página e devolve a resposta (null quando a página sumiu no meio).
// aba: teclado e mouse de verdade na aba: clicar(x, y), apagarTudo(), digitar(texto), enter(), reabrir() (fecha e abre de novo).
// Responde { ok, etapa, erro, postou, saiu }: postou false = parou antes de clicar em Publicar (pode tentar de novo).
export async function postar(executar, aba, job, { espera = 1 } = {}) {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms * espera));
  const estado = async () => (await executar(estadoStudio, [])) || {};
  let etapa = 'abrir o TikTok Studio', postou = false;
  const parar = (erro) => ({ ok: false, etapa, erro, postou });
  const esperar = async (ok, ms) => {
    const fim = Date.now() + ms * espera;
    for (;;) {
      const e = await estado();
      if (e.login || e.quebrou || ok(e)) return e;
      if (Date.now() > fim) return null;
      await executar(fecharAvisos, []);
      await dormir(1000);
    }
  };
  try {
    let e = await esperar((s) => s.input || s.editor, 60000);
    if (e?.quebrou) {
      // rascunho quebrado guardado no navegador: limpa e abre a página de novo
      await executar(limparRascunhos, []);
      await aba.reabrir();
      e = await esperar((s) => s.input || s.editor, 60000);
      if (e?.quebrou) return parar('o TikTok Studio mostra "Algo deu errado" mesmo sem rascunho');
    }
    if (!e) return parar('a página de enviar vídeo não abriu');
    if (e.login) return { ...parar('não está logado no TikTok'), saiu: true };
    if (e.editor) {
      etapa = 'descartar um rascunho antigo';
      await executar(descartarRascunho, []);
      e = await esperar((s) => s.input && !s.editor, 30000);
      if (!e || e.editor) return parar('não consegui descartar o rascunho que estava aberto');
    }
    await dormir(2500);
    await executar(fecharAvisos, []);

    etapa = 'anexar o vídeo';
    let a = null;
    if (aba.pedacosDoVideo) {
      // o background baixa da central (sem precisar da permissão de rede local da página) e manda em pedaços
      const pedacos = await aba.pedacosDoVideo(job.video);
      for (let vez = 0; vez < 2 && !a?.ok; vez++) {
        a = null;
        for (let i = 0; i < pedacos.length; i++) {
          const r = await executar(receberPedaco, [i, pedacos.length, pedacos[i]]);
          if (!r || r.erro) { a = r || { erro: 'a página recarregou no meio do vídeo' }; break; }
        }
        if (!a) a = await executar(anexarDosPedacos, [pedacos.length]);
      }
    } else a = await executar(anexarVideo, [job.video]);
    if (!a || a.erro) return parar(a?.erro || 'a página recarregou ao anexar');

    etapa = 'esperar o vídeo carregar';
    e = await esperar((s) => s.editor || s.falhou, 120000);
    if (!e) return parar('a caixa da legenda não apareceu');
    if (e.quebrou) { await executar(limparRascunhos, []); return parar('o TikTok Studio quebrou ("Algo deu errado"); limpei o rascunho'); }
    if (e.falhou) return parar('o TikTok mostrou "Falha no carregamento"');

    etapa = 'escrever a legenda';
    const linhas = linhasDaLegenda(job.legenda);
    let escrito = false;
    for (let vez = 0; vez < 2 && !escrito; vez++) {
      await dormir(1500);
      await executar(fecharAvisos, []);
      const p = await executar(alvo, ['legenda']);
      if (!p) return parar('a caixa da legenda sumiu');
      await aba.clicar(p.x, p.y);
      await dormir(300);
      await aba.apagarTudo();
      for (let i = 0; i < linhas.length; i++) {
        if (i) await aba.enter();
        if (linhas[i]) await aba.digitar(linhas[i]);
        await dormir(250);
      }
      await dormir(1000);
      const s = await estado();
      if (s.quebrou) { await executar(limparRascunhos, []); return parar('o TikTok Studio quebrou ao escrever a legenda; limpei o rascunho'); }
      escrito = igual((await executar(lerLegenda, []))?.texto, linhas.join('\n'));
    }
    if (!escrito) return parar('a legenda não ficou igual à do painel');

    etapa = 'esperar o vídeo subir';
    e = await esperar((s) => s.pronto || s.falhou, 15 * 60000);
    if (!e?.pronto || e.falhou) return parar(e?.falhou ? 'o TikTok mostrou "Falha no carregamento"' : 'o vídeo não terminou de subir');

    etapa = 'clicar em Publicar';
    await executar(fecharAvisos, []);
    const b = await executar(alvo, ['publicar']);
    if (!b) return parar('o botão Publicar sumiu');
    postou = true; // daqui em diante nunca vai de novo, mesmo sem resposta: nunca postar duas vezes
    await aba.clicar(b.x, b.y);

    etapa = 'confirmar a publicação';
    // a verificação de conteúdo pode estar rodando: o TikTok pergunta "Publicar agora?" numa janela
    e = await esperar((s) => s.publicado || s.agora, 3 * 60000);
    if (e?.agora && !e.publicado) {
      await executar(clicarPublicarAgora, []);
      e = await esperar((s) => s.publicado, 3 * 60000);
    }
    if (!e?.publicado) return parar('não vi o aviso de vídeo publicado (confira no perfil)');
    return { ok: true, etapa: 'publicado', postou };
  } catch (err) {
    return parar(String(err?.message || err).slice(0, 240));
  }
}
