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
  formatos: ['meio', 'jogo'], // without a camera use ["jogo"] and formatoPadrao "jogo"
  formatoPadrao: 'auto',
  // captions: modo 'karaoke' (short line, word turns yellow as spoken) or 'palavra' (one big word at a time, with a pop)
  estilo: { font: 'Bricolage Grotesque', primary: '#FFE600', base: '#FFFFFF', outline: '#000000', modo: 'karaoke', ganchoSeg: 1e9 }, // ganchoSeg: the hook stays as a title the whole cut
  cortarSilencio: {}, // jump cuts on pauses in the speech (src/corte.js encolherSilencios); false turns it off
  efeitos: { whoosh: true },
  // brand on the video: the @ of the cut's line (src/canais.js), the symbol in the corner and "SEGUE @..." at the end
  marca: { arroba: '', chamada: 'SEGUE', mostrarLogo: true, mostrarArroba: true },
  intro: { noLongo: true, nosCortes: false, duracao: 1.2 },
  // 'skill': approved cuts go to pastaEntrega for the owner's posting skill; 'upload-post': this platform schedules them
  postagem: 'skill',
  pastaEntrega: path.join(HOME, 'Gameplay', 'prontos'),
  // the code of the "FNANDO: TikTok pelo Chrome" extension (src/tiktokChrome.js), created on the first panel start
  arquivoTokenTiktok: path.join(HOME, 'Gameplay', '.tiktok-chrome-token'),
  // the central (src/central.js): scripts and ideas, and the numbers of the accounts (written by the posting skill)
  pastaRoteiros: path.join(HOME, 'Gameplay', 'roteiros'),
  arquivoMetricas: path.join(HOME, 'Gameplay', 'metricas.json'),
  arquivoRadar: path.join(HOME, 'Gameplay', 'radar', 'tendencias.json'), // copied from the `radar` branch (src/radar.js)
  corBarra: '0xFFE600',
  semIa: false,
  // posting (src/postagem.js): UPLOAD_POST_API_KEY in the environment + the profile name here
  uploadPost: { perfil: '', redes: ['tiktok', 'instagram', 'youtube'], horarios: ['12:00', '18:30', '21:00'], horariosLongo: ['19:00'] },
  // one YouTube video per mission (src/missoes.js): { passo: seconds between frames, minSeg: shortest mission }; false turns it off
  missoes: { passo: 6, minSeg: 150 },
  videoLongo: true, // also build the full YouTube video of each session
  silencioMax: 20, // in the long video, a stretch without speech longer than this shrinks to 4 s
  // live mode: see docs/ao-vivo.md. whisper here overrides the model while live (a lighter one keeps the Mac free for OBS)
  aoVivo: { ligado: false, cortesPorBloco: 2, whisper: {} },
  // automatic framing in the game-only formats (src/corte.js focosDe): false turns it off; { reacoes: false } keeps only the minimap
  enquadramento: {},
  // posts per account per day, at most (src/canais.js LIMITES_SEGUROS: tiktok 4, instagram 3, youtube 4, facebook 3)
  limites: {},
  // automatic pace chosen by the owner: per network per day up to maxPorDia, following the size of the queue
  ritmo: { automatico: false, maxPorDia: 15, minPorDia: 4, longosPorDia: 3, inicio: '09:00', fim: '23:30' },
  // edit effects (src/efeitos.js): profanity 'pesado' (slurs and heavy words, default), 'todos' (every swear) or false;
  // the beep goes in the sound and the word shows as "C******" in the caption
  filtroPalavroes: 'pesado',
  palavroesExtras: [],
  // background music: royalty-free tracks dropped in pasta, low, ducking under the voice; none when the folder is empty
  musica: { ligado: true, pasta: path.join(HOME, 'Gameplay', 'musicas'), volume: 0.12 },
  temCamera: false, // false: only the game-only formats (no webcam yet)
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
  return { ...PADRAO, ...user, whisper: { ...PADRAO.whisper, ...(user.whisper || {}) }, estilo: { ...PADRAO.estilo, ...(user.estilo || {}) }, marca: { ...PADRAO.marca, ...(user.marca || {}) }, intro: { ...PADRAO.intro, ...(user.intro || {}) }, uploadPost: { ...PADRAO.uploadPost, ...(user.uploadPost || {}) }, aoVivo: { ...PADRAO.aoVivo, ...(user.aoVivo || {}) }, ritmo: { ...PADRAO.ritmo, ...(user.ritmo || {}) } };
}

// the central saves the pace (ritmo) chosen by the owner into config.json and into the running config
export function salvarRitmo(config, patch, file = process.env.GAMEPLAY_CONFIG || path.join(ROOT, 'config.json')) {
  const r = { ...config.ritmo };
  if ('automatico' in patch) r.automatico = !!patch.automatico;
  for (const k of ['maxPorDia', 'longosPorDia', 'minPorDia']) if (patch[k] != null) { const n = Math.round(Number(patch[k])); if (!(n >= 1 && n <= 50)) throw new Error(`${k} precisa ser de 1 a 50.`); r[k] = n; }
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  user.ritmo = r;
  fs.writeFileSync(file, JSON.stringify(user, null, 2));
  config.ritmo = r;
  return r;
}
