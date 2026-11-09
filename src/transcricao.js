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

export async function transcrever(wav, { modelo, idioma = 'pt', threads = 8, bin = 'whisper-cli' } = {}) {
  if (!modelo || !fs.existsSync(modelo)) throw new Error(`Modelo do Whisper não encontrado: ${modelo || '(vazio)'}. Rode: sh tools/instalar-mac.sh`);
  const base = wav.replace(/\.wav$/, '');
  await run(bin, ['-m', modelo, '-f', wav, '-l', idioma, '-t', String(threads), '-ml', '1', '-sow', '-oj', '-of', base], { timeoutMs: 4 * 3600000 });
  const json = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  return palavrasDoWhisper(json);
}

// Words inside [start, end], with times relative to start (for the captions of one cut).
export function palavrasEntre(words, start, end) {
  return words.filter((w) => w.end > start && w.start < end).map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.min(end, w.end) - start }));
}

export const textoEntre = (words, start, end) => words.filter((w) => w.end > start && w.start < end).map((w) => w.text).join(' ');

export const caminhoTmp = (dir, nome) => { fs.mkdirSync(dir, { recursive: true }); return path.join(dir, nome); };
