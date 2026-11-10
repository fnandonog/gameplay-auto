#!/usr/bin/env python3
"""Gera a identidade visual (FNANDO + CLIPAÍ): logos em SVG (texto já convertido em curva) e PNGs para as redes e o OBS.
Uso: pip install fonttools cairosvg && python3 tools/marca/gerar.py   → public/marca/ e docs/marca/
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import cairosvg

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SVG_DIR = os.path.join(RAIZ, 'public', 'marca')
PNG_DIR = os.path.join(RAIZ, 'docs', 'marca')
os.makedirs(SVG_DIR, exist_ok=True); os.makedirs(PNG_DIR, exist_ok=True)

AMARELO, PRETO, BRANCO, CIANO, VERMELHO, ROSA, VERDE, GRAFITE = '#FFE600', '#0B0B0F', '#FFFFFF', '#00E0FF', '#FF3B30', '#FF2D95', '#22C55E', '#1A1B22'

_fontes = {}
def fonte(wght=800, wdth=75):
    k = (wght, wdth)
    if k not in _fontes:
        f = TTFont(os.path.join(RAIZ, 'fonts', 'BricolageGrotesque.ttf'))
        _fontes[k] = instantiateVariableFont(f, {'wght': wght, 'wdth': wdth, 'opsz': 96})
    return _fontes[k]

def texto(s, x, y, tam, cor, wght=800, wdth=75, ancora='start', track=0):
    """Texto como <path> (não depende de fonte instalada). y = linha de base."""
    f = fonte(wght, wdth); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
    esc = tam / upm
    larg = sum(gs[cmap.get(ord(ch), cmap[ord('?')])].width for ch in s) * esc + track * (len(s) - 1)
    x0 = x - larg if ancora == 'end' else x - larg / 2 if ancora == 'middle' else x
    partes, cx = [], x0
    for ch in s:
        g = cmap.get(ord(ch), cmap[ord('?')])
        pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (esc, 0, 0, -esc, cx, y)))
        partes.append(pen.getCommands())
        cx += gs[g].width * esc + track
    return f'<path fill="{cor}" d="{" ".join(partes)}"/>', larg

def svg(w, h, corpo, fundo=None):
    bg = f'<rect width="{w}" height="{h}" fill="{fundo}"/>' if fundo else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{bg}{corpo}</svg>'

def salvar(nome, conteudo, png=None, svg_publico=True):
    if svg_publico:
        open(os.path.join(SVG_DIR, nome + '.svg'), 'w').write(conteudo)
    if png:
        cairosvg.svg2png(bytestring=conteudo.encode(), write_to=os.path.join(PNG_DIR, nome + '.png'), output_width=png[0], output_height=png[1])

# ---------- FNANDO: símbolo (F + "play") ----------
def simbolo_fnando(fundo=AMARELO, tinta=PRETO, selo=None, selo_cor=PRETO, selo_tinta=AMARELO):
    f, _ = texto('F', 256, 372 if not selo else 330, 400, tinta, ancora='middle')
    play = f'<path fill="{tinta}" d="M{352 if not selo else 352} {300 if not selo else 258} l78 46 -78 46z"/>'
    corpo = f'<rect width="512" height="512" rx="112" fill="{fundo}"/><g transform="translate(-30 0)">{f}</g>{play}'
    if selo:
        t, lw = texto(selo, 256, 452, 64, selo_tinta, ancora='middle', track=2)
        corpo += f'<rect x="{256 - lw / 2 - 26}" y="398" width="{lw + 52}" height="74" rx="37" fill="{selo_cor}"/>{t}'
    return svg(512, 512, corpo)

def wordmark_fnando(cor=BRANCO, destaque=AMARELO, w=1200, h=300, fundo=None):
    t, lw = texto('FNANDO', w / 2, 220, 240, cor, ancora='middle', track=6)
    barra = f'<path fill="{destaque}" d="M{w / 2 - lw / 2} 246 h{lw} l-14 26 h-{lw}z"/>'
    return svg(w, h, t + barra, fundo)

# ---------- CLIPAÍ: símbolo (marcas de corte + play) ----------
def simbolo_clipai(fundo=PRETO, tinta=CIANO):
    c = lambda d: f'<path fill="none" stroke="{tinta}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round" d="{d}"/>'
    corpo = (f'<rect width="512" height="512" rx="112" fill="{fundo}"/>' + c('M110 190 V110 H190') + c('M322 110 H402 V190') +
             c('M402 322 V402 H322') + c('M190 402 H110 V322') + f'<path fill="{tinta}" d="M214 176 L346 256 L214 336z"/>')
    return svg(512, 512, corpo)

def wordmark_clipai(cor=BRANCO, destaque=CIANO, w=1200, h=300, fundo=None):
    a, la = texto('CLIPA', 0, 0, 240, cor, track=6)
    i, li = texto('Í', 0, 0, 240, destaque)
    total = la + 6 + li
    a, _ = texto('CLIPA', w / 2 - total / 2, 220, 240, cor, track=6)
    i, _ = texto('Í', w / 2 - total / 2 + la + 6, 220, 240, destaque)
    return svg(w, h, a + i, fundo)

# ---------- peças ----------
def listras(w, h, cor, op=0.12, passo=90):
    return ''.join(f'<path d="M{x} 0 l{h} {h} h40 l-{h} -{h}z" fill="{cor}" opacity="{op}"/>' for x in range(-h, w, passo))

def banner(marca):
    w, h = 2560, 1440
    if marca == 'fnando':
        cor, simb, wm = AMARELO, simbolo_fnando(), wordmark_fnando()
        linha1, linha2 = 'LIVES DE EA FC 26 NO PS5', 'TER · QUI · SÁB · 20H'
    else:
        cor, simb, wm = CIANO, simbolo_clipai(), wordmark_clipai()
        linha1, linha2 = 'OS MELHORES CORTES DAS LIVES', 'SÓ DE STREAMERS QUE AUTORIZARAM'
    t1, _ = texto(linha1, 1280, 900, 64, BRANCO, wght=700, ancora='middle', track=4)
    t2, _ = texto(linha2, 1280, 980, 52, cor, wght=700, ancora='middle', track=4)
    interno = lambda s, x, y, sc: f'<g transform="translate({x} {y}) scale({sc})">{s.split(">", 1)[1].rsplit("</svg>", 1)[0]}</g>'
    nome = 'FNANDO' if marca == 'fnando' else 'CLIPAÍ'
    _, lw = texto(nome, 0, 0, 240, BRANCO, track=6)
    sc, lado = 1.0, 250                       # wordmark em escala 1, símbolo de 250 px
    total = lado + 50 + lw * sc
    x0 = 1280 - total / 2
    corpo = (listras(w, h, cor) + f'<rect x="0" y="{h - 26}" width="{w}" height="26" fill="{cor}"/>' +
             interno(simb, x0, 520, lado / 512) + interno(wm, x0 + lado + 50 - (600 - lw / 2) * sc, 520 - 20, sc) + t1 + t2)
    return svg(w, h, corpo, PRETO)

def thumb_modelo(marca):
    w, h = 1280, 720
    cor = AMARELO if marca == 'fnando' else CIANO
    t1, _ = texto('TEXTO GRANDE', 70, 330, 120, PRETO, ancora='start')
    t2, _ = texto('AQUI', 70, 460, 140, PRETO, ancora='start')
    simb = simbolo_fnando() if marca == 'fnando' else simbolo_clipai()
    inner = simb.split('>', 1)[1].rsplit('</svg>', 1)[0]
    corpo = (f'<rect width="{w}" height="{h}" fill="{GRAFITE}"/>' + listras(w, h, BRANCO, 0.05, 60) +
             f'<text x="980" y="380" font-family="sans-serif" font-size="34" fill="#777" text-anchor="middle">seu rosto / lance aqui</text>' +
             f'<path fill="{cor}" d="M0 0 H760 L620 720 H0z"/>' + t1 + t2 +
             f'<g transform="translate(1150 590) scale(0.22)">{inner}</g>' +
             f'<rect x="0" y="0" width="{w}" height="{h}" fill="none" stroke="{cor}" stroke-width="14"/>')
    return svg(w, h, corpo)

def overlay_live():
    """1920x1080 transparente para o OBS: moldura da câmera, selo AO VIVO e barra com os @."""
    w, h = 1920, 1080
    cx, cy, cw, ch = 1440, 40, 440, 248   # janela da câmera (canto superior direito)
    ao, _ = texto('AO VIVO', 96, 92, 40, BRANCO, wght=800, track=3)
    bar, _ = texto('@FNANDO  ·  TIKTOK  ·  INSTAGRAM  ·  YOUTUBE', 960, 1052, 30, PRETO, wght=800, ancora='middle', track=3)
    simb = simbolo_fnando().split('>', 1)[1].rsplit('</svg>', 1)[0]
    corpo = (f'<rect x="{cx - 8}" y="{cy - 8}" width="{cw + 16}" height="{ch + 16}" rx="18" fill="none" stroke="{AMARELO}" stroke-width="8"/>' +
             f'<rect x="40" y="40" width="250" height="72" rx="14" fill="{VERMELHO}"/><circle cx="72" cy="76" r="11" fill="{BRANCO}"/>{ao}' +
             f'<rect x="0" y="1016" width="{w}" height="64" fill="{AMARELO}"/>{bar}' +
             f'<g transform="translate({cx + cw - 92} {cy + ch - 92}) scale(0.16)">{simb}</g>')
    return svg(w, h, corpo)

def tela_comecando():
    w, h = 1920, 1080
    wm = wordmark_fnando().split('>', 1)[1].rsplit('</svg>', 1)[0]
    t1, _ = texto('A LIVE JÁ VAI COMEÇAR', 960, 700, 72, AMARELO, wght=800, ancora='middle', track=4)
    t2, _ = texto('PEGA O CONTROLE E CHAMA OS PARÇAS', 960, 780, 40, BRANCO, wght=600, ancora='middle', track=3)
    return svg(w, h, listras(w, h, AMARELO) + f'<g transform="translate(360 260) scale(1)">{wm}</g>' + t1 + t2, PRETO)

if __name__ == '__main__':
    salvar('fnando-simbolo', simbolo_fnando(), (512, 512))
    salvar('fnando-wordmark', wordmark_fnando(), (1200, 300))
    salvar('fnando-wordmark-escuro', wordmark_fnando(cor=PRETO, destaque=PRETO), (1200, 300))
    salvar('clipai-simbolo', simbolo_clipai(), (512, 512))
    salvar('clipai-wordmark', wordmark_clipai(), (1200, 300))
    # avatar de cada conta: mesmo F, cor e selo diferentes para não confundir as linhas
    salvar('avatar-fnando', simbolo_fnando(), (800, 800), svg_publico=False)
    salvar('avatar-fnando-shorts', simbolo_fnando(VERMELHO, BRANCO, 'SHORTS', BRANCO, VERMELHO), (800, 800))
    salvar('avatar-fnando-resenha', simbolo_fnando(ROSA, BRANCO, 'RESENHA', BRANCO, ROSA), (800, 800))
    salvar('avatar-fnando-dicas', simbolo_fnando(VERDE, PRETO, 'DICAS', PRETO, VERDE), (800, 800))
    salvar('avatar-clipai', simbolo_clipai(), (800, 800), svg_publico=False)
    salvar('banner-youtube-fnando', banner('fnando'), (2560, 1440), svg_publico=False)
    salvar('banner-youtube-clipai', banner('clipai'), (2560, 1440), svg_publico=False)
    salvar('thumb-modelo-fnando', thumb_modelo('fnando'), (1280, 720), svg_publico=False)
    salvar('thumb-modelo-clipai', thumb_modelo('clipai'), (1280, 720), svg_publico=False)
    salvar('obs-overlay-live', overlay_live(), (1920, 1080), svg_publico=False)
    salvar('obs-tela-comecando', tela_comecando(), (1920, 1080), svg_publico=False)
    print('Pronto:', SVG_DIR, PNG_DIR)
