const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const R = process.argv[2]; const out = path.join(R, 'public/marca/redes');
const sim = fs.readFileSync(path.join(R, 'public/marca/fnando-simbolo.svg'), 'utf8').replace('rx="112"', 'rx="0"');
const word = fs.readFileSync(path.join(R, 'public/marca/fnando-wordmark.svg'), 'utf8');
const font = 'data:font/ttf;base64,' + fs.readFileSync(path.join(R, 'fonts/BricolageGrotesque.ttf')).toString('base64');
const css = `@font-face{font-family:B;src:url(${font})} *{margin:0;box-sizing:border-box} body{background:#0B0B0F;font-family:B;overflow:hidden}`;
const banner = (w, h, safeW, safeH) => `<style>${css}
.wrap{width:${w}px;height:${h}px;position:relative;background:radial-gradient(ellipse at 70% 40%,#2a2600 0,#0B0B0F 60%);}
.stripe{position:absolute;inset:0;background:repeating-linear-gradient(115deg,transparent 0 140px,rgba(255,230,0,.05) 140px 150px)}
.safe{position:absolute;left:${(w - safeW) / 2}px;top:${(h - safeH) / 2}px;width:${safeW}px;height:${safeH}px;display:flex;align-items:center;gap:${safeH * .12}px}
.safe svg:first-child{width:${safeH * .78}px;height:${safeH * .78}px;flex:none;border-radius:${safeH * .17}px}
.t{display:flex;flex-direction:column;gap:${safeH * .05}px}.t svg{width:${safeW * .5}px;height:auto;margin-left:-${safeW * .115}px;margin-top:-${safeH*.12}px;margin-bottom:-${safeH*.12}px}
.w{color:#fff;font-weight:800;font-size:${safeH*.42}px;line-height:.9;letter-spacing:-.01em}.s{color:#FFE600;font-weight:800;font-size:${safeH * .14}px;letter-spacing:.02em;white-space:nowrap}.s2{color:#fff;opacity:.8;font-size:${safeH * .11}px}</style>
<div class="wrap"><div class="stripe"></div><div class="safe">${sim.replace('rx="0"','rx="112"')}<div class="t"><div class="w">FNANDO</div><div class="s">GTA 6 · CURIOSIDADES E DICAS</div><div class="s2">Corte novo todo dia</div></div></div></div>`;
(async () => { const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 1 });
  const shot = async (html, w, h, f) => { await p.setViewportSize({ width: w, height: h }); await p.setContent(html); await p.waitForTimeout(300); await p.screenshot({ path: path.join(out, f), type: f.endsWith('jpg') ? 'jpeg' : 'png', quality: f.endsWith('jpg') ? 92 : undefined }); };
  await shot(`<style>${css} svg{width:1080px;height:1080px;display:block}</style>${sim}`, 1080, 1080, 'avatar-fnando.png');
  await shot(banner(2560, 1440, 1546, 423), 2560, 1440, 'banner-youtube.jpg');
  await shot(banner(1640, 856, 1200, 360), 1640, 856, 'capa-facebook.jpg');
  await b.close(); })();
