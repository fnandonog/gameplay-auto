// Keys and tokens of the official APIs (Meta and YouTube), only in ~/Gameplay/.credenciais.json (owner-only, outside git).
// The app ids are public; the secrets are pasted once by the owner in the Contas tab (only on this Mac) and the tokens come
// from the "Conectar" buttons (OAuth on localhost:4322). Nothing here is ever sent back to the page.
import { acharClaude } from './contaClaude.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const arquivoCredenciais = (config = {}) => config.arquivoCredenciais || path.join(os.homedir(), 'Gameplay', '.credenciais.json');

// public ids of the apps the owner already has (FNexus Publicador and its Google client); not secrets
export const PUBLICOS = {
  meta: { appId: '1155674466876889', configId: '1147801621101637' },
  youtube: { clientId: '871511977621-9phoia00ff38nd959qldj645rc27dfhg.apps.googleusercontent.com' },
};

export function lerCredenciais(file) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  return { meta: { ...PUBLICOS.meta, ...(c.meta || {}) }, youtube: { ...PUBLICOS.youtube, ...(c.youtube || {}) }, ia: { ...(c.ia || {}) } };
}

export function salvarCredenciais(file, rede, patch) {
  if (!['meta', 'youtube', 'ia'].includes(rede)) throw new Error('Rede inválida.');
  if (rede === 'ia' && patch.apiKey && !/^sk-ant-[\w-]{20,}$/.test(patch.apiKey)) throw new Error('Essa não parece uma chave da Anthropic (começa com sk-ant-).');
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  c[rede] = { ...(c[rede] || {}), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return lerCredenciais(file);
}

// the AI key pasted in the central goes into this process (the Anthropic SDK reads ANTHROPIC_API_KEY)
export function aplicarChaveIa(file, env = process.env, { trocar = false } = {}) {
  const k = lerCredenciais(file).ia.apiKey;
  if (k && (trocar || !env.ANTHROPIC_API_KEY)) env.ANTHROPIC_API_KEY = k;
  return !!env.ANTHROPIC_API_KEY;
}

// pure: what the Contas tab shows for each network posted through an API (never a secret)
export function statusApis(c) {
  const erros = { instagram: c.meta?.erro, facebook: c.meta?.erro, youtube: c.youtube?.erro };
  const st = (pronto, conectado, rede) => {
    if (erros[rede]) return { status: 'erro', motivo: erros[rede] };
    if (!pronto) return { status: 'falta credencial', motivo: 'Cole a chave secreta do app e salve.' };
    if (!conectado) return { status: 'falta conectar', motivo: 'Clique em Conectar e autorize.' };
    return { status: 'conectada', motivo: '' };
  };
  const m = c.meta || {}, y = c.youtube || {};
  const metaPronto = !!(m.appId && m.appSecret);
  return {
    instagram: { ...st(metaPronto, !!(m.pageToken && m.igUserId), 'instagram'), conta: m.igUsername ? `@${m.igUsername}` : '' },
    facebook: { ...st(metaPronto, !!(m.pageToken && m.pageId), 'facebook'), conta: m.pageName || '' },
    youtube: { ...st(!!(y.clientId && y.clientSecret), !!y.refreshToken, 'youtube'), conta: y.channelTitle || '', privado: !!y.travadoPrivado },
    meta: { appId: m.appId || '', configId: m.configId || '', temSegredo: !!m.appSecret },
    google: { clientId: y.clientId || '', temSegredo: !!y.clientSecret },
    ia: { temChave: !!(c.ia?.apiKey || process.env.ANTHROPIC_API_KEY), conta: !!acharClaude() },
  };
}
