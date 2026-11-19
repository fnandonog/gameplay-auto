// A cada 2 minutos (e quando o Chrome abre) pergunta à central do FNANDO (o painel do gameplay-auto neste Mac,
// http://localhost:4322) se há corte para o TikTok. Quando há, abre o TikTok Studio numa janela própria, roda os passos de
// studio.js (vídeo, legenda digitada, Publicar), fecha e conta à central como foi. Um vídeo por vez, na hora marcada de
// cada post (agendarPara do post.json em ~/Gameplay/prontos).
// Nada do navegador é lido além da página do TikTok Studio que ela abriu, e nada vai a lugar nenhum além da central.
// A cada 4 minutos confere na central qual é a versão da pasta extensao-tiktok: se for mais nova, recarrega sozinha.
// Lado do servidor: src/tiktokChrome.js (rotas /api/tiktok-chrome/... em src/painel.js).
import { postar } from './studio.js';
import { postarYoutube } from './youtube.js';

export const PAINEL = 'http://localhost:4322';
const STUDIO = 'https://www.tiktok.com/tiktokstudio/upload?from=upload';
const YT_UPLOAD = 'https://www.youtube.com/upload';

async function marcar(texto, titulo) {
  await chrome.action.setBadgeText({ text: texto });
  await chrome.action.setBadgeBackgroundColor({ color: texto === '!' ? '#C62828' : '#111111' });
  await chrome.action.setTitle({ title: `FNANDO: ${titulo}` });
}

// TikTok Studio numa janela própria, sem foco (as abas do dono ficam como estão); devolve a aba e a janela.
async function abrirStudio(url = STUDIO) {
  const janela = await chrome.windows.create({ url, focused: false, width: 1280, height: 900 });
  const id = janela.tabs[0].id;
  await new Promise((ok, falha) => {
    const fim = setTimeout(() => { chrome.tabs.onUpdated.removeListener(ver); falha(new Error('o Studio não abriu')); }, 60000);
    function ver(t, info) { if (t === id && info.status === 'complete') { clearTimeout(fim); chrome.tabs.onUpdated.removeListener(ver); ok(); } }
    chrome.tabs.onUpdated.addListener(ver);
  });
  return { tabId: id, windowId: janela.id };
}
// fechar a janela não para na pergunta "Sair do site?" do TikTok
const fechar = (a) => (a ? chrome.windows.remove(a.windowId).catch(() => {}) : null);

// Teclas e cliques de verdade na aba (Chrome DevTools Protocol pelo chrome.debugger): o editor da legenda aceita como
// digitação de uma pessoa, o que não acontece com texto posto por script (studio.js diz por quê). Enquanto está ligado, o
// Chrome mostra a faixa "começou a depurar este navegador"; desliga no fim de cada post.
function teclado(aba) {
  let ligado = null;
  const alvo = () => ({ tabId: aba.tabId });
  const ligar = async () => {
    ligado ||= (async () => {
      await chrome.debugger.attach(alvo(), '1.3');
      // a janela não tem foco: a página age como se tivesse, para o editor manter o cursor
      await chrome.debugger.sendCommand(alvo(), 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    })();
    return ligado;
  };
  // a página do Studio troca de frame enquanto carrega ("Frame with ID 0 was removed", "Detached"): liga de novo uma vez
  const cdp = async (method, params) => {
    try { await ligar(); return await chrome.debugger.sendCommand(alvo(), method, params); } catch (e) {
      if (!/frame|detached|not attached|target closed/i.test(String(e?.message || e))) throw e;
      ligado = null;
      await chrome.debugger.detach(alvo()).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      await ligar();
      return chrome.debugger.sendCommand(alvo(), method, params);
    }
  };
  const tecla = async (key, code, vk, extra = {}) => {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, ...extra });
    if (key === 'Enter') await cdp('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', windowsVirtualKeyCode: vk });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };
  return {
    async clicar(x, y) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async apagarTudo() {
      await tecla('a', 'KeyA', 65, { commands: ['selectAll'] });
      await tecla('Backspace', 'Backspace', 8);
    },
    digitar: (text) => cdp('Input.insertText', { text }),
    enter: () => tecla('Enter', 'Enter', 13),
    async reabrir() {
      await this.soltar();
      await fechar(aba);
      Object.assign(aba, await abrirStudio());
    },
    async soltar() {
      if (!ligado) return;
      ligado = null;
      await chrome.debugger.detach(alvo()).catch(() => {});
    },
  };
}

let rodando = false;
export async function rodada() {
  if (rodando) return;
  rodando = true;
  // um post leva minutos: uma chamada leve a cada 20 s mantém o service worker acordado
  const acordado = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  let aba = null, teclas = null;
  try {
    const { codigo, painel = PAINEL } = await chrome.storage.local.get(['codigo', 'painel']);
    if (!codigo) { await marcar('?', 'cole o código da central (aba Contas) nas opções'); return; }
    const auth = { authorization: `Bearer ${codigo}`, 'x-extensao-versao': chrome.runtime.getManifest().version };
    const r = await fetch(`${painel}/api/tiktok-chrome/proximo`, { headers: auth, credentials: 'omit' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `a central respondeu ${r.status}`);
    const { job: jobTt, atualizar } = await r.json();
    await chrome.storage.local.set({ vistoEm: Date.now(), ultimoErro: null });
    if (atualizar) { await marcar('!', atualizar); return; }
    // sem TikTok agora: pergunta se há vídeo do YouTube (o que passa da cota da API)
    let job = jobTt, rede = 'tiktok';
    if (!job) {
      const y = await fetch(`${painel}/api/tiktok-chrome/yt-proximo`, { headers: auth, credentials: 'omit' }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
      if (y.job) { job = y.job; rede = 'youtube'; }
    }
    if (!job) { await marcar('', 'esperando o próximo vídeo'); return; }
    const nomeRede = rede === 'youtube' ? 'YouTube' : 'TikTok';
    await marcar('▲', `postando um vídeo no ${nomeRede}`);
    let res;
    try {
      aba = await abrirStudio(rede === 'youtube' ? YT_UPLOAD : STUDIO);
      teclas = teclado(aba);
      // os arquivos vêm da central pelo background (a página pode não ter a permissão de rede local do Chrome)
      teclas.pedacos = async (url) => {
        const r = await fetch(url, { credentials: 'omit' });
        if (!r.ok) throw new Error(`a central respondeu ${r.status} ao baixar o arquivo`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const pedacos = [];
        for (let i = 0; i < bytes.length; i += 3 * 1024 * 1024) {
          const fatia = bytes.subarray(i, i + 3 * 1024 * 1024);
          let bin = '';
          for (let k = 0; k < fatia.length; k += 0x8000) bin += String.fromCharCode.apply(null, fatia.subarray(k, k + 0x8000));
          pedacos.push(btoa(bin));
        }
        return pedacos;
      };
      teclas.pedacosDoVideo = teclas.pedacos;
      // um passo curto por vez; um passo cuja página recarregou no meio responde null e postar pede de novo
      const executar = async (func, args) => {
        try { const [r] = await chrome.scripting.executeScript({ target: { tabId: aba.tabId }, func, args }); return r?.result ?? null; } catch { return null; }
      };
      res = rede === 'youtube'
        ? await postarYoutube(executar, teclas, { ...job, video: `${painel}${job.video}`, capa: job.capa ? `${painel}${job.capa}` : null })
        : await postar(executar, teclas, { ...job, video: `${painel}${job.video}` });
    } catch (e) {
      res = { ok: false, etapa: `abrir o ${nomeRede} Studio`, erro: String(e.message || e).slice(0, 240), postou: false };
    }
    await fetch(`${painel}/api/tiktok-chrome/${rede === 'youtube' ? 'yt-resultado' : 'resultado'}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ id: job.id, ...res }), credentials: 'omit' });
    await chrome.storage.local.set({ ultimoPost: { em: Date.now(), rede, ...res } });
    await marcar(res.ok ? '' : '!', res.ok ? `vídeo publicado no ${nomeRede}` : res.saiu ? `entre de novo no ${nomeRede}` : `${nomeRede} parou em "${res.etapa}": ${res.erro}`);
  } catch (e) {
    await chrome.storage.local.set({ ultimoErro: `${new Date().toLocaleString('pt-BR')}: ${e.message}` });
    await marcar('!', `Erro: ${e.message}`);
  } finally {
    clearInterval(acordado);
    await teclas?.soltar();
    await fechar(aba);
    rodando = false;
  }
}

const maior = (a, b) => {
  const n = (x) => String(x || '0').split('.').map((p) => Number(p) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
export async function conferirVersao() {
  try {
    const { painel = PAINEL } = await chrome.storage.local.get('painel');
    const r = await fetch(`${painel}/api/tiktok-chrome/versao`, { credentials: 'omit' });
    if (!r.ok) return;
    const { versao } = await r.json();
    await chrome.storage.local.set({ versaoPainel: versao || null });
    if (!versao || !maior(versao, chrome.runtime.getManifest().version)) return;
    const { recarregou = {} } = await chrome.storage.local.get('recarregou');
    if (recarregou.versao === versao && Date.now() - recarregou.em < 6 * 3600000) return;
    await chrome.storage.local.set({ recarregou: { versao, em: Date.now() } });
    if (!rodando) chrome.runtime.reload();
  } catch {}
}

if (globalThis.chrome?.alarms) {
  chrome.alarms.create('tiktok', { periodInMinutes: 2 });
  chrome.alarms.create('versao', { periodInMinutes: 4 });
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tiktok') rodada(); else if (a.name === 'versao') conferirVersao(); });
  chrome.runtime.onStartup.addListener(() => { rodada(); conferirVersao(); });
  chrome.runtime.onInstalled.addListener(rodada);
  chrome.runtime.onMessage.addListener((m, _s, responder) => { if (m === 'agora') { rodada().then(conferirVersao).then(() => responder(true)); return true; } return false; });
}
