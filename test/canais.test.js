import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { distribuirLinhas, linhasDe, LINHAS_SUGERIDAS } from '../src/canais.js';
import { postarAprovados } from '../src/postagem.js';

test('sem config.linhas vira uma linha só, igual ao uploadPost antigo', () => {
  const [l] = linhasDe({ uploadPost: { perfil: 'canal', redes: ['tiktok'], horarios: ['12:00'] } });
  assert.deepEqual([l.perfil, l.redes, l.horarios], ['canal', ['tiktok'], ['12:00']]);
});

test('cada corte vai para uma linha só, em rodízio pela nota, sem mandar nada para o CLIPAÍ nem para Dicas', () => {
  const cs = [{ nota: 6 }, { nota: 9 }, { nota: 8 }, { nota: 7, linha: 'resenha' }, { nota: 5, linha: 'nao-existe' }];
  distribuirLinhas(cs, LINHAS_SUGERIDAS);
  assert.deepEqual(cs.map((c) => c.linha), ['resenha', 'principal', 'shorts', 'resenha', 'principal']);
  assert.ok(!cs.some((c) => ['clipai', 'dicas'].includes(c.linha)));
});

test('agenda cada corte no perfil e nas redes da sua linha; perfis diferentes podem usar o mesmo horário', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linhas-'));
  fs.mkdirSync(path.join(dir, 's1'));
  const c = { titulo: 't', descricao: '', hashtags: [], status: 'aprovado' };
  fs.writeFileSync(path.join(dir, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [
    { ...c, arquivo: 'a.mp4', nota: 9, linha: 'principal' }, { ...c, arquivo: 'b.mp4', nota: 8, linha: 'shorts' }, { ...c, arquivo: 'c.mp4', nota: 7, linha: 'principal' },
  ] }));
  const linhas = [
    { id: 'principal', nome: 'FNANDO', perfil: 'fnando', redes: ['tiktok', 'instagram'], horarios: ['21:00', '12:00'] },
    { id: 'shorts', nome: 'FNANDO Shorts', perfil: 'fnando-shorts', redes: ['youtube'], horarios: ['21:00'] },
  ];
  process.env.UPLOAD_POST_API_KEY = 'x';
  const env = [];
  await postarAprovados({ pastaSaida: dir, linhas }, { log: () => {}, agora: Date.parse('2026-11-09T23:40:00Z'),
    envio: async ({ video, campos }) => { const g = (k) => campos.filter(([n]) => n === k).map(([, v]) => v); env.push([path.basename(video), g('user')[0], g('platform[]').join('+'), g('scheduled_date')[0]]); return 'j'; } });
  delete process.env.UPLOAD_POST_API_KEY;
  assert.deepEqual(env, [
    ['a.mp4', 'fnando', 'tiktok+instagram', '2026-11-10T00:00:00Z'],
    ['b.mp4', 'fnando-shorts', 'youtube', '2026-11-10T00:00:00Z'],
    ['c.mp4', 'fnando', 'tiktok+instagram', '2026-11-10T15:00:00Z'],
  ]);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 's1', 'sessao.json'), 'utf8'));
  assert.deepEqual(s.cortes.map((x) => x.perfil), ['fnando', 'fnando-shorts', 'fnando']);
});

test('CLIPAÍ: crédito vai na legenda e corte de terceiro sem permissão nunca é aprovado sozinho', async () => {
  const { textos, autoAprovar } = await import('../src/postagem.js');
  const c = { titulo: 'Ele surtou', descricao: '', hashtags: ['clipai'], credito: { streamer: '@streamer', link: 'https://twitch.tv/streamer' } };
  assert.match(textos(c).legenda, /Crédito: @streamer · https:\/\/twitch\.tv\/streamer/);
  const ok = { status: 'aguardando', nota: 10, titulo: 't', gancho: 'g', inicio: 0, fim: 30 };
  const cs = [{ ...ok, linha: 'clipai' }, { ...ok, credito: c.credito }, { ...ok, linha: 'principal' }];
  assert.equal(autoAprovar(cs, 8, LINHAS_SUGERIDAS), 1);
  assert.deepEqual(cs.map((x) => x.status), ['descartado', 'descartado', 'aprovado']);
});
