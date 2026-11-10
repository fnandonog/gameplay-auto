import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoAprovar, camposPost, postarAprovados, proximoHorario, textos } from '../src/postagem.js';

const corte = { arquivo: '01-a.mp4', titulo: 'ELE NÃO ESPERAVA essa 😱', descricao: 'Que finalização. Você faria igual?', hashtags: ['eafc26', 'ps5'], nota: 9, status: 'aprovado' };

test('legenda junta título, descrição e hashtags; YouTube ganha #shorts', () => {
  const t = textos(corte);
  assert.equal(t.legenda, 'ELE NÃO ESPERAVA essa 😱\n\nQue finalização. Você faria igual?\n\n#eafc26 #ps5');
  assert.equal(t.tituloYoutube, 'ELE NÃO ESPERAVA essa 😱 #shorts');
});

test('campos do Upload-Post para as três redes', () => {
  const f = camposPost(corte, { perfil: 'canal', redes: ['tiktok', 'instagram', 'youtube'], quando: '2026-11-10T15:00:00Z' });
  const get = (k) => f.filter(([n]) => n === k).map(([, v]) => v);
  assert.deepEqual(get('platform[]'), ['tiktok', 'instagram', 'youtube']);
  assert.deepEqual(get('media_type'), ['REELS']);
  assert.deepEqual(get('categoryId'), ['20']);
  assert.deepEqual(get('tags[]'), ['eafc26', 'ps5']);
  assert.deepEqual(get('scheduled_date'), ['2026-11-10T15:00:00Z']);
  assert.deepEqual(get('first_comment'), ['Que finalização. Você faria igual?']);
});

test('próximo horário de pico em Brasília, pulando os ocupados', () => {
  const agora = Date.parse('2026-11-09T23:40:00Z'); // 20:40 em Brasília
  assert.equal(proximoHorario(agora, ['12:00', '18:30', '21:00']), '2026-11-10T00:00:00Z'); // 21:00 de hoje
  assert.equal(proximoHorario(agora, ['12:00', '18:30', '21:00'], ['2026-11-10T00:00:00Z']), '2026-11-10T15:00:00Z'); // 12:00 de amanhã
  assert.equal(proximoHorario(Date.parse('2026-11-09T23:50:00Z'), ['21:00']), '2026-11-11T00:00:00Z'); // margem de 20 min
});

test('piloto automático: aprova o que passa no filtro e descarta o resto com o motivo', () => {
  const ok = { titulo: 't', gancho: 'g', inicio: 10, fim: 40 };
  const cs = [{ ...ok, status: 'aguardando', nota: 8.5 }, { ...ok, status: 'aguardando', nota: 6 }, { ...ok, status: 'descartado', nota: 9 }];
  assert.equal(autoAprovar(cs, 8), 1);
  assert.deepEqual(cs.map((c) => c.status), ['aprovado', 'descartado', 'descartado']);
  assert.match(cs[1].filtro[0], /nota 6/);
});

test('agenda os aprovados, o melhor primeiro, e grava no sessao.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-'));
  fs.mkdirSync(path.join(dir, 's1'));
  fs.writeFileSync(path.join(dir, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [
    { ...corte, arquivo: 'a.mp4', nota: 7 }, { ...corte, arquivo: 'b.mp4', nota: 9 }, { ...corte, arquivo: 'c.mp4', status: 'aguardando' },
  ] }));
  process.env.UPLOAD_POST_API_KEY = 'x';
  const enviados = [];
  const n = await postarAprovados({ pastaSaida: dir, uploadPost: { perfil: 'canal', horarios: ['12:00', '21:00'] } }, {
    log: () => {}, agora: Date.parse('2026-11-09T23:40:00Z'), envio: async ({ video, campos }) => { enviados.push([path.basename(video), campos.find(([k]) => k === 'scheduled_date')[1]]); return 'job1'; },
  });
  delete process.env.UPLOAD_POST_API_KEY;
  assert.equal(n, 2);
  assert.deepEqual(enviados, [['b.mp4', '2026-11-10T00:00:00Z'], ['a.mp4', '2026-11-10T15:00:00Z']]);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 's1', 'sessao.json'), 'utf8'));
  assert.deepEqual(s.cortes.map((c) => c.status), ['agendado', 'agendado', 'aguardando']);
  assert.equal(s.pasta, undefined);
});

test('sem chave do Upload-Post não faz nada', async () => {
  assert.equal(await postarAprovados({ pastaSaida: '/nao/existe', uploadPost: { perfil: 'x' } }), 0);
});

test('vídeo longo aprovado vai só para o YouTube às 19:00', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-'));
  fs.mkdirSync(path.join(dir, 's1'));
  fs.writeFileSync(path.join(dir, 's1', 'sessao.json'), JSON.stringify({ sessao: 's1', cortes: [], longo: { arquivo: 'youtube-completo.mp4', thumb: 'youtube-thumb.jpg', titulo: 'Partida', descricao: 'Capítulos', status: 'aprovado' } }));
  process.env.UPLOAD_POST_API_KEY = 'x';
  let campos;
  await postarAprovados({ pastaSaida: dir, uploadPost: { perfil: 'canal' } }, { log: () => {}, agora: Date.parse('2026-11-09T12:00:00Z'), envio: async (e) => { campos = e.campos; return 'j'; } });
  delete process.env.UPLOAD_POST_API_KEY;
  assert.deepEqual(campos.filter(([k]) => k === 'platform[]').map(([, v]) => v), ['youtube']);
  assert.equal(campos.find(([k]) => k === 'scheduled_date')[1], '2026-11-09T22:00:00Z');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 's1', 'sessao.json'), 'utf8')).longo.status, 'agendado');
});
