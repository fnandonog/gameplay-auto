// Settings: defaults here, overridden by config.json (next to package.json) or the file in GAMEPLAY_CONFIG.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();

export const PADRAO = {
  pastaEntrada: path.join(HOME, 'Gameplay', 'inbox'), // where OBS records
  pastaSaida: path.join(HOME, 'Gameplay', 'cortes'), // one folder per session, with the cuts and sessao.json
  pastaProcessados: path.join(HOME, 'Gameplay', 'gravacoes'), // recordings move here once processed
  jogo: '', // e.g. "EA FC 26"; goes to the AI and the hashtags
  canal: '',
  cortesPorSessao: 6,
  segundosAntes: 40, // a voice command / marker keeps this much before it
  segundosDepois: 8,
  faixaMic: 1, // OBS track 2 = microphone only (stream a:1)
  faixaJogo: 2, // OBS track 3 = game only (stream a:2)
  whisper: { bin: 'whisper-cli', modelo: path.join(HOME, 'Gameplay', 'modelos', 'ggml-large-v3-turbo.bin'), idioma: 'pt' },
  camPct: 0.4, // camera takes 40% of the vertical screen
  zoomJogo: 1,
  fps: 60,
  regiaoCamera: null, // scene mode only: {x,y,w,h} of the camera inside the 1920x1080 scene
  offsetCamera: 0, // seconds the camera file is ahead (+) or behind (-) the game file
  // cut formats (src/corte.js FORMATOS): meio (camera half / game half), camtopo (camera 40%), jogo (game square over the
  // blurred game), jogocheio (game fills the screen). Every cut is rendered in each one; formatoPadrao picks the one that
  // goes to posting ('auto': meio when there is speech, jogo when it is a quiet play).
  formatos: ['meio', 'jogo'],
  formatoPadrao: 'auto',
  // captions: modo 'karaoke' (short line, word turns yellow as spoken) or 'palavra' (one big word at a time, with a pop)
  estilo: { font: 'Bricolage Grotesque', primary: '#FFE600', base: '#FFFFFF', outline: '#000000', modo: 'karaoke' },
  // brand on the video: the @ of the cut's line (src/canais.js), the symbol in the corner and "SEGUE @..." at the end
  marca: { arroba: '', chamada: 'SEGUE', mostrarLogo: true, mostrarArroba: true },
  intro: { noLongo: true, nosCortes: false, duracao: 1.2 },
  // 'skill': approved cuts go to pastaEntrega for the owner's posting skill; 'upload-post': this platform schedules them
  postagem: 'skill',
  pastaEntrega: path.join(HOME, 'Gameplay', 'prontos'),
  corBarra: '0xFFE600',
  semIa: false,
  // posting (src/postagem.js): UPLOAD_POST_API_KEY in the environment + the profile name here
  uploadPost: { perfil: '', redes: ['tiktok', 'instagram', 'youtube'], horarios: ['12:00', '18:30', '21:00'], horariosLongo: ['19:00'] },
  videoLongo: true, // also build the full YouTube video of each session
  silencioMax: 20, // in the long video, a stretch without speech longer than this shrinks to 4 s
  postarAutomatico: false, // true: cuts with nota >= notaMinima are posted without approval
  notaMinima: 8,
  portaPainel: 4321,
  senhaPainel: '', // set one so nobody else on the Wi-Fi opens the panel; open once with /?senha=...
  // file name words that tell the Source Record files apart
  nomesCamera: ['camera', 'câmera', 'gopro', 'cam', 'webcam'],
  nomesJogo: ['jogo', 'game', 'placa', 'ps5', 'captura'],
};

export function carregarConfig(file = process.env.GAMEPLAY_CONFIG || path.join(ROOT, 'config.json')) {
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...PADRAO, ...user, whisper: { ...PADRAO.whisper, ...(user.whisper || {}) }, estilo: { ...PADRAO.estilo, ...(user.estilo || {}) }, marca: { ...PADRAO.marca, ...(user.marca || {}) }, intro: { ...PADRAO.intro, ...(user.intro || {}) }, uploadPost: { ...PADRAO.uploadPost, ...(user.uploadPost || {}) } };
}
