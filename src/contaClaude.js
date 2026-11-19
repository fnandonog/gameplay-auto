// The AI through the owner's own Claude account: the Claude Code CLI already signed in on this Mac (`claude -p`),
// no API key. It mimics the two SDK calls the pipeline uses (messages.create and messages.stream().finalMessage()),
// so ia.js and missoes.js do not change. With ANTHROPIC_API_KEY set, the SDK is used instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

const CANDIDATOS = ['claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];

export function acharClaude(env = process.env, existe = fs.existsSync) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  for (const c of CANDIDATOS) {
    if (c.includes('/')) { if (existe(c)) return c; continue; }
    for (const d of String(env.PATH || '').split(path.delimiter)) if (d && existe(path.join(d, c))) return path.join(d, c);
  }
  return null;
}

// pure: the request as one prompt; images become files the CLI reads with its Read tool
export function montarPrompt({ system = '', messages = [], output_config: oc } = {}, salvarImagem = null) {
  const partes = [];
  if (system) partes.push(system);
  for (const m of messages) {
    const blocos = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
    for (const b of blocos) {
      if (b.type === 'text') partes.push(b.text);
      else if (b.type === 'image' && salvarImagem) partes.push(`[imagem: leia o arquivo ${salvarImagem(b.source)}]`);
    }
  }
  const schema = oc?.format?.schema;
  if (schema) partes.push(`Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem cercas de código, seguindo exatamente este JSON Schema:\n${JSON.stringify(schema)}`);
  return partes.join('\n\n');
}

// pure: the JSON object inside the CLI's answer (tolerates ```json fences and a sentence around it)
export function extrairJson(txt) {
  const s = String(txt || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('A IA não respondeu em JSON.');
  const j = s.slice(a, b + 1);
  JSON.parse(j);
  return j;
}

function rodar(bin, args, entrada, timeoutMs) {
  return new Promise((ok, fail) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ANTHROPIC_API_KEY: '' } });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    p.on('error', (e) => { clearTimeout(t); fail(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? ok(out) : fail(new Error(`claude saiu com ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`)); });
    p.stdin.end(entrada);
  });
}

export function clienteDaConta({ bin = acharClaude(), timeoutMs = 15 * 60000 } = {}) {
  if (!bin) throw new Error('O Claude Code não está instalado neste Mac.');
  const create = async (params) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gameplay-ia-'));
    try {
      let n = 0;
      const salvar = (src) => { const f = path.join(dir, `img-${String(++n).padStart(3, '0')}.${src.media_type === 'image/png' ? 'png' : 'jpg'}`); fs.writeFileSync(f, Buffer.from(src.data, 'base64')); return f; };
      const prompt = montarPrompt(params, salvar);
      const args = ['-p', '--output-format', 'json', ...(n ? ['--allowedTools', 'Read', '--add-dir', dir] : ['--allowedTools', ''])];
      const r = JSON.parse(await rodar(bin, args, prompt, timeoutMs));
      if (r.is_error) throw new Error(String(r.result || 'erro na conta Claude').slice(0, 300));
      const txt = params.output_config?.format?.schema ? extrairJson(r.result) : String(r.result || '');
      return { content: [{ type: 'text', text: txt }], stop_reason: 'end_turn' };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  return { conta: true, messages: { create, stream: (params) => ({ finalMessage: () => create(params) }) } };
}

// API key when there is one; otherwise the owner's Claude account on this Mac; otherwise throws (titles stay generic)
export function clienteIa(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return new Anthropic();
  return clienteDaConta({ bin: acharClaude(env) });
}
export const temIa = (env = process.env) => !!(env.ANTHROPIC_API_KEY || acharClaude(env));
