// Transcription of the microphone track with whisper.cpp (runs on the Mac's own chip, no cost), one entry per word.
import fs from 'node:fs';
import path from 'node:path';
import { run } from './run.js';

// Pulls one audio track out of the recording as 16 kHz mono WAV (what whisper wants).
// OBS track 2 (mic only) is the stream a:1; when the file has only one track, a:0.
export function argsExtrairAudio(video, wav, { track = 1, temTrack = true } = {}) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-map', `0:a:${temTrack ? track : 0}`, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav];
}

// whisper-cli with -ml 1 -sow writes one segment per word: { offsets: { from, to } (ms), text }.
export function palavrasDoWhisper(json) {
  const segs = json?.transcription || [];
  const out = [];
  for (const s of segs) {
    const text = String(s.text || '').trim();
    if (!text || /^\[.*\]$/.test(text)) continue; // [música], [BLANK_AUDIO]
    const start = (s.offsets?.from ?? 0) / 1000, end = (s.offsets?.to ?? 0) / 1000;
    // a leading punctuation-only token sticks to the word before it
    if (/^[.,!?;:…]+$/.test(text) && out.length) { out[out.length - 1].text += text; out[out.length - 1].end = end; continue; }
    out.push({ text, start, end: Math.max(end, start + 0.05) });
  }
  return out;
}

// Whisper invents credits in silence or music ("Legendado por Sônia", "Legendas pela comunidade Amara.org",
// "Obrigado por assistir") and sometimes loops one phrase. Pure: drops those words before they reach captions.
const ALUCINACOES = [
  ['legendado', 'por'], ['legendada', 'por'], ['legendas', 'por'], ['legenda', 'por'], ['legendas', 'pela'], ['legendagem', 'por'],
  ['transcricao', 'por'], ['traducao', 'por'], ['revisao', 'por'], ['subtitles', 'by'], ['subtitulos', 'por'], ['captions', 'by'],
  ['amara', 'org'], ['amaraorg'], ['legendas', 'pela', 'comunidade'], ['pela', 'comunidade', 'amara'], ['obrigado', 'por', 'assistir'], ['obrigada', 'por', 'assistir'], ['inscreva', 'se', 'no', 'canal'],
  ['ate', 'o', 'proximo', 'video'], ['e', 'isso', 'pessoal'],
];
const normPalavra = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
export function removerAlucinacoes(words, { nomeDepois = 3, maxRepeticoes = 2 } = {}) {
  const toks = [];
  words.forEach((w, i) => { for (const t of normPalavra(w.text).split(/\s+/).filter(Boolean)) toks.push({ t, i }); });
  const fora = new Set();
  for (let k = 0; k < toks.length; k++) {
    for (const f of ALUCINACOES) {
      if (!f.every((x, j) => toks[k + j]?.t === x)) continue;
      const credito = f.length === 2 && /^(por|pela|by)$/.test(f[1]);
      const ate = k + f.length + (credito ? nomeDepois : 0);
      for (let j = k; j < Math.min(ate, toks.length); j++) {
        // after "legendado por" only a Name (capitalized) goes too
        if (credito && j >= k + f.length && (!/^[A-ZÀ-Ý]/.test(String(words[toks[j].i].text).trim()) || words[toks[j].i].start - words[toks[j - 1].i].end > 1.5)) break;
        fora.add(toks[j].i);
      }
    }
  }
  // a phrase of 2-6 words repeated more than maxRepeticoes times in a row is a loop: keep the first copies
  const ws = words.map((w) => normPalavra(w.text));
  for (let n = 2; n <= 6; n++) for (let k = 0; k + n * (maxRepeticoes + 1) <= ws.length; k++) {
    const frase = ws.slice(k, k + n).join(' ');
    let r = 1;
    while (ws.slice(k + r * n, k + (r + 1) * n).join(' ') === frase) r++;
    if (r > maxRepeticoes) for (let j = k + maxRepeticoes * n; j < k + r * n; j++) fora.add(j);
  }
  return words.filter((_, i) => !fora.has(i));
}

export async function transcrever(wav, { modelo, idioma = 'pt', threads = 8, bin = 'whisper-cli' } = {}) {
  if (!modelo || !fs.existsSync(modelo)) throw new Error(`Modelo do Whisper não encontrado: ${modelo || '(vazio)'}. Rode: sh tools/instalar-mac.sh`);
  const base = wav.replace(/\.wav$/, '');
  await run(bin, ['-m', modelo, '-f', wav, '-l', idioma, '-t', String(threads), '-ml', '1', '-sow', '-oj', '-of', base], { timeoutMs: 4 * 3600000 });
  const json = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  return removerAlucinacoes(palavrasDoWhisper(json));
}

// Words inside [start, end], with times relative to start (for the captions of one cut).
export function palavrasEntre(words, start, end) {
  return words.filter((w) => w.end > start && w.start < end).map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.min(end, w.end) - start }));
}

export const textoEntre = (words, start, end) => words.filter((w) => w.end > start && w.start < end).map((w) => w.text).join(' ');

export const caminhoTmp = (dir, nome) => { fs.mkdirSync(dir, { recursive: true }); return path.join(dir, nome); };
