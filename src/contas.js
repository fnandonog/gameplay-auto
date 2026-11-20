// Account manager for the central's "Contas" tab: which accounts the lines need, how far each one is in its creation
// checklist, whether the owner's posting skill sees it (metricas.json) and whether it needs a reconnect. Progress lives
// in contas.json next to the metrics. Never store passwords, codes or keys there: only ticks, the @ and a note.
import fs from 'node:fs';
import path from 'node:path';
import { linhasDe } from './canais.js';

const lerJson = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
export const arquivoContas = (config) => config.arquivoContas || path.join(path.dirname(config.arquivoMetricas || '.'), 'contas.json');

// Steps per network. `anonimo` marks the steps that keep the channel away from his personal profile and contacts.
// Live rules change often: `live` says what we know and the app is the final word.
export const GUIA = {
  youtube: {
    nome: 'YouTube', entrar: 'https://studio.youtube.com',
    passos: [
      { id: 'email', t: 'Criar um e-mail novo só para o canal (Gmail), sem seu nome', anonimo: true },
      { id: 'canal', t: 'No YouTube, criar o canal com o nome anônimo (conta de marca, não o seu nome)' },
      { id: 'verificar', t: 'Verificar o canal em youtube.com/verify (o número não aparece para ninguém)', anonimo: true },
      { id: 'contatos', t: 'Não importar contatos e não ligar ao seu Google pessoal', anonimo: true },
      { id: 'visual', t: 'Foto, banner, descrição e o link das outras redes' },
      { id: 'conectar', t: 'Conectar na sua skill de autopost' },
    ],
    live: { pode: true, resumo: 'Pelo PC (OBS) ou direto do PS5, sem mínimo de inscritos.', requisito: 'Canal verificado e 24 h de espera depois de ativar a live. No celular precisa de 50 inscritos.' },
  },
  tiktok: {
    nome: 'TikTok', entrar: 'https://www.tiktok.com/login',
    passos: [
      { id: 'email', t: 'Criar com o e-mail novo (não com o seu telefone)', anonimo: true },
      { id: 'contatos', t: 'Não sincronizar contatos nem amigos do Facebook', anonimo: true },
      { id: 'sugerir', t: 'Privacidade > Sugerir sua conta a outras pessoas: desligar tudo (contatos, Facebook, conexões em comum, quem abre seu link)', anonimo: true },
      { id: 'empresa', t: 'Mudar para conta comercial ou de criador (Ferramentas para criador)' },
      { id: 'visual', t: 'Foto, nome, bio e link' },
      { id: 'conectar', t: 'Conectar na sua skill de autopost' },
    ],
    live: { pode: false, resumo: 'Só depois de 1.000 seguidores e com 18 anos ou mais.', requisito: 'Para transmitir pelo OBS ainda precisa do TikTok LIVE Studio ou de chave liberada pelo TikTok.' },
  },
  facebook: {
    nome: 'Página do Facebook', entrar: 'https://www.facebook.com/pages/create',
    passos: [
      { id: 'pagina', t: 'Pelo seu Facebook, criar uma Página nova com o nome anônimo (categoria: Criador de conteúdo de jogos)' },
      { id: 'naoconvidar', t: 'Pular o "convidar amigos" e não compartilhar a Página no seu perfil', anonimo: true },
      { id: 'transparencia', t: 'Conferir que o seu nome não aparece na Página (a Transparência só mostra o país)', anonimo: true },
      { id: 'visual', t: 'Foto, capa e descrição' },
      { id: 'conectar', t: 'Conectar na sua skill de autopost' },
    ],
    live: { pode: true, resumo: 'Página faz live pelo OBS (Live Producer, com chave) sem mínimo de seguidores.', requisito: 'Confira no Live Producer se a Página já está liberada.' },
  },
  instagram: {
    nome: 'Instagram', entrar: 'https://www.instagram.com/accounts/emailsignup/',
    precisa: 'facebook',
    passos: [
      { id: 'email', t: 'Criar com o e-mail novo, não pelo "continuar com o Facebook"', anonimo: true },
      { id: 'contatos', t: 'Não sincronizar contatos e pular as sugestões de quem seguir', anonimo: true },
      { id: 'central', t: 'Quando pedir para entrar na Central de Contas junto do seu perfil pessoal, recusar', anonimo: true },
      { id: 'sugestoes', t: 'Editar perfil > Sugestões de contas semelhantes: desligar', anonimo: true },
      { id: 'profissional', t: 'Mudar para conta profissional (Criador)' },
      { id: 'pagina', t: 'Ligar à Página do Facebook (Editar perfil > Página): é o que permite postar pela skill' },
      { id: 'conectar', t: 'Conectar na sua skill de autopost' },
    ],
    live: { pode: false, resumo: 'Conta pública precisa de 1.000 seguidores para fazer live.', requisito: 'Live é pelo app, ou pelo OBS com o Live Producer depois de liberado.' },
  },
  twitch: {
    nome: 'Twitch', entrar: 'https://www.twitch.tv/signup',
    passos: [
      { id: 'email', t: 'Criar com o e-mail novo', anonimo: true },
      { id: 'dois', t: 'Ligar a verificação em 2 etapas (pedida para transmitir)' },
      { id: 'visual', t: 'Foto, banner e painéis' },
      { id: 'obs', t: 'Colar a chave de transmissão no OBS (só no OBS, nunca aqui)' },
    ],
    live: { pode: true, resumo: 'Live liberada desde o primeiro dia, pelo OBS ou direto do PS5.', requisito: 'Bom para começar as lives enquanto TikTok e Instagram não chegam a 1.000.' },
  },
};

const chave = (linha, rede) => `${linha}|${rede}`;

// pure: planned accounts (+ the Facebook Page each Instagram needs) + saved progress + metrics → one row per account
export function estadoContas({ linhas = [], salvo = {}, metricas = null, agora = Date.now(), velhoHoras = 48 }) {
  const lista = [];
  const add = (linha, nome, rede, extra = {}) => { if (GUIA[rede] && !lista.some((c) => c.chave === chave(linha, rede))) lista.push({ chave: chave(linha, rede), linha, nome, rede, ...extra }); };
  for (const l of linhas) {
    for (const r of l.redes || []) add(l.id, l.nome, r, { arroba: l.arroba || '' });
    if ((l.redes || []).includes('instagram')) add(l.id, l.nome, 'facebook', { soPara: 'instagram' });
  }
  for (const [k, v] of Object.entries(salvo.contas || {})) { const [linha, rede] = k.split('|'); if (v?.extra) add(linha, v.nome || linha, rede); }
  const contasM = metricas?.contas || [];
  const velho = metricas?.atualizadoEm ? agora - Date.parse(metricas.atualizadoEm) > velhoHoras * 3600e3 : false;
  return lista.map((c) => {
    const s = salvo.contas?.[c.chave] || {};
    const g = GUIA[c.rede];
    const feitos = g.passos.filter((p) => s.passos?.[p.id]).length;
    const m = contasM.find((x) => x.rede === c.rede && (x.linha === c.linha || (x.nome && x.nome === c.nome)));
    let status = feitos === 0 ? 'a criar' : feitos < g.passos.length ? 'criando' : 'criada';
    if (m) status = m.erro || m.reconectar || velho ? 'reconectar' : 'conectada';
    return {
      ...c, arroba: s.arroba || m?.arroba || c.arroba || '', nota: s.nota || '', status, feitos, total: g.passos.length,
      passos: g.passos.map((p) => ({ ...p, feito: !!s.passos?.[p.id] })), seguidores: m?.seguidores ?? null, link: m?.link || '',
      motivo: m?.erro || (status === 'reconectar' ? (m?.reconectar || `Sem números novos há mais de ${velhoHoras} h`) : ''),
      precisa: g.precisa ? chave(c.linha, g.precisa) : null,
    };
  });
}

// what each network allows for lives today, given the followers we have
export function ondeDaLive(estado) {
  return Object.entries(GUIA).map(([rede, g]) => {
    const contas = estado.filter((c) => c.rede === rede);
    const seg = Math.max(0, ...contas.map((c) => c.seguidores || 0));
    const pode = g.live.pode || (/1\.000/.test(g.live.resumo) && seg >= 1000);
    return { rede, nome: g.nome, ...g.live, pode, seguidores: contas.length ? seg : null };
  });
}

export function lerContas(config) {
  const salvo = lerJson(arquivoContas(config), {}) || {};
  const estado = estadoContas({ linhas: linhasDe(config), salvo, metricas: lerJson(config.arquivoMetricas, null) });
  return { arquivo: arquivoContas(config), contas: estado, live: ondeDaLive(estado) };
}

const PROIBIDO = /senha|password|c[oó]digo|token|chave|key|secret/i;
// one change from the tab: tick a step, set the @ or a note, or add an account to a line
export function salvarConta(config, { chave: k, passo, feito, arroba, nota, nova } = {}) {
  const f = arquivoContas(config);
  const salvo = lerJson(f, {}) || {};
  salvo.contas ||= {};
  if (nova) {
    if (!GUIA[nova.rede]) throw new Error('Rede desconhecida.');
    const linha = String(nova.linha || nova.nome || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    if (!linha) throw new Error('Dê um nome para a conta.');
    salvo.contas[chave(linha, nova.rede)] = { ...(salvo.contas[chave(linha, nova.rede)] || {}), extra: true, nome: String(nova.nome || linha).slice(0, 60) };
  } else {
    if (!/^[\w-]+\|[a-z]+$/.test(String(k || '')) || !GUIA[k.split('|')[1]]) throw new Error('Conta inválida.');
    const c = (salvo.contas[k] ||= {});
    if (passo !== undefined) {
      if (!GUIA[k.split('|')[1]].passos.some((p) => p.id === passo)) throw new Error('Passo inválido.');
      (c.passos ||= {})[passo] = !!feito;
    }
    if (arroba !== undefined) {
      const a = String(arroba).trim().replace(/^@?/, '@');
      if (a !== '@' && !/^@[\w.]{2,30}$/.test(a)) throw new Error('O @ só pode ter letras, números, ponto e _.');
      c.arroba = a === '@' ? '' : a;
    }
    if (nota !== undefined) {
      if (PROIBIDO.test(nota)) throw new Error('Não guarde senha, código ou chave aqui.');
      c.nota = String(nota).slice(0, 300);
    }
  }
  salvo.atualizadoEm = new Date().toISOString();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(salvo, null, 2));
  fs.renameSync(f + '.tmp', f);
  return lerContas(config);
}
