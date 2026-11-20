import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pastaSsd, pastasDeGravacao, ajustarInbox, postadoEmTudo, limparPostados } from '../src/disco.js';
import { pastaDoCorte } from '../src/entrega.js';

test('SSD only when its volume is mounted', () => {
  const c = { ssd: { pasta: '/Volumes/SSD/FNANDO' }, pastaEntrada: '/h/Gameplay/inbox', pastaProcessados: '/h/Gameplay/gravacoes' };
  assert.equal(pastaSsd(c, () => true), '/Volumes/SSD/FNANDO');
  assert.equal(pastaSsd(c, () => false), null);
  assert.deepEqual(pastasDeGravacao(c, () => false), { inbox: '/h/Gameplay/inbox-interno', gravacoes: '/h/Gameplay/gravacoes', ssd: false });
  assert.equal(pastasDeGravacao(c, () => true).inbox, '/Volumes/SSD/FNANDO/inbox');
});

test('the OBS folder becomes a link to the SSD and moves waiting recordings along', async () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ssd-'));
  const inbox = path.join(h, 'inbox');
  fs.mkdirSync(inbox); fs.writeFileSync(path.join(inbox, 'a.mp4'), 'x');
  const config = { ssd: { pasta: path.join(h, 'ssd', 'FNANDO') }, pastaEntrada: inbox, pastaProcessados: path.join(h, 'gravacoes') };
  // recording in progress: nothing changes
  assert.equal(await ajustarInbox(config, { aberto: async () => true }), null);
  assert.equal(fs.lstatSync(inbox).isSymbolicLink(), false);
  const r = await ajustarInbox(config);
  assert.equal(fs.readlinkSync(inbox), r.inbox);
  assert.ok(fs.existsSync(path.join(r.inbox, 'a.mp4')));
  assert.ok(fs.readdirSync(h).some((n) => n.startsWith('inbox-antiga-')));
});

test('posted on every network', () => {
  const post = { linha: { redes: ['tiktok', 'youtube'] } };
  assert.equal(postadoEmTudo(post, { links: { tiktok: 'publicado' } }), false);
  assert.equal(postadoEmTudo(post, { links: { tiktok: 'publicado' }, emRede: { youtube: 'x' } }), true);
});

test('cleaning deletes the videos of fully posted cuts and keeps covers, texts and links', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'limpa-'));
  const config = { pastaSaida: path.join(h, 'cortes'), pastaEntrega: path.join(h, 'prontos'), linhas: [{ id: 'fnando', redes: ['tiktok', 'instagram'] }] };
  const ses = path.join(config.pastaSaida, 's1');
  fs.mkdirSync(ses, { recursive: true });
  const corte = { arquivo: '01-pia-meio.mp4', variantes: { meio: '01-pia-meio.mp4', jogo: '01-pia-jogo.mp4' }, linha: 'fnando', status: 'postado' };
  const pendente = { arquivo: '02-x-meio.mp4', variantes: { meio: '02-x-meio.mp4' }, linha: 'fnando', status: 'entregue' };
  fs.writeFileSync(path.join(ses, 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [corte, pendente] }));
  for (const f of ['01-pia-meio.mp4', '01-pia-jogo.mp4', '01-pia-meio.jpg', '02-x-meio.mp4']) fs.writeFileSync(path.join(ses, f), 'v');
  const linha = { id: 'fnando', redes: ['tiktok', 'instagram'] };
  const mk = (c, postado) => {
    const d = pastaDoCorte(config.pastaEntrega, { linha, sessao: 's1', arquivo: c.arquivo });
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'post.json'), JSON.stringify({ linha }));
    fs.writeFileSync(path.join(d, 'video.mp4'), 'v'); fs.writeFileSync(path.join(d, 'capa.jpg'), 'c');
    fs.writeFileSync(path.join(d, 'postado.json'), JSON.stringify(postado));
    return d;
  };
  const velho = '2026-11-19T10:00:00Z';
  const d1 = mk(corte, { em: velho, links: { tiktok: 'publicado', instagram: 'https://x' }, emRede: { tiktok: velho, instagram: velho } });
  const d2 = mk(pendente, { em: velho, links: { tiktok: 'publicado' }, emRede: { tiktok: velho } });
  const r = limparPostados(config, { agora: Date.parse('2026-11-19T20:00:00Z') });
  assert.equal(r.apagados, 3);
  assert.ok(!fs.existsSync(path.join(d1, 'video.mp4'))); assert.ok(fs.existsSync(path.join(d1, 'capa.jpg')));
  assert.ok(!fs.existsSync(path.join(ses, '01-pia-jogo.mp4'))); assert.ok(fs.existsSync(path.join(ses, '01-pia-meio.jpg')));
  assert.ok(fs.existsSync(path.join(d2, 'video.mp4'))); assert.ok(fs.existsSync(path.join(ses, '02-x-meio.mp4')));
  assert.ok(JSON.parse(fs.readFileSync(path.join(d1, 'postado.json'), 'utf8')).limpoEm);
  // too soon after the last post: kept
  const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'x'));
  assert.equal(limparPostados({ ...config, pastaEntrega: d3 }).apagados, 0);
});
