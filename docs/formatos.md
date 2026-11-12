# Formatos dos cortes, legenda, marca, intro e entrega

## Formatos

Cada corte sai em todos os formatos de `formatos` no `config.json` (padrão: `["meio", "jogo"]`):

| Formato | Como fica |
|---|---|
| `meio` | Câmera na metade de cima, jogo na metade de baixo. A legenda fica na linha do meio. |
| `camtopo` | Câmera com 40% da tela, jogo com 60% (`camPct` muda a proporção). |
| `jogo` | Só o jogo: um quadrado grande da ação no meio, com o próprio jogo desfocado atrás. |
| `jogocheio` | Só o jogo ocupando a tela toda (as laterais são cortadas; `zoomJogo` aperta mais). |

`formatoPadrao` diz qual vai para a postagem. Com `"auto"`, um trecho com fala vai em `meio` (a reação importa) e um lance calado vai em `jogo`. No painel, o seletor de formato troca o vídeo na hora, e o formato escolhido é salvo quando você aprova.

## Legenda

`estilo.modo`:
- `karaoke`: frase curta, e cada palavra fica amarela quando é falada.
- `palavra`: uma palavra por vez, grande, com um "pop". Palavras longas ficam amarelas.

O gancho aparece grande em cima nos primeiros 2,5 s.

## Marca no vídeo

A marca vem da linha do corte (`src/canais.js`). Cada linha tem `arroba`, e a do CLIPAÍ tem `marca: "clipai"`.
- O @ fica pequeno no canto o vídeo todo.
- O símbolo da marca (FNANDO amarelo, CLIPAÍ ciano) fica no canto.
- Nos 2 s finais aparece "SEGUE @...". O texto vem de `marca.chamada`; use `false` para desligar.
- A barra de progresso tem a cor da marca.

`marca.mostrarLogo` e `marca.mostrarArroba` desligam cada parte. Os @ sugeridos são `@fnando`, `@fnandoshorts`, `@fnandoresenha`, `@fnandodicas` e `@clipai`; troque pelos reais em `linhas` no `config.json`.

O @ é gravado no vídeo na hora de montar. Se você trocar a linha de um corte no painel, o vídeo continua com o @ antigo.

## Intro

A intro tem 1,2 s: o logo entra sobre fundo escuro, uma faixa da cor da marca passa e toca um whoosh. É gerada uma vez por marca a partir de `docs/marca/*-wordmark.png` e fica guardada em `<pastaSaida>/.intro/`.
- `intro.noLongo` (padrão ligado): no vídeo do YouTube, a intro entra depois da prévia de 10 s, e os capítulos já contam com ela.
- `intro.nosCortes` (padrão desligado): coloca a intro na frente dos cortes. Nos Shorts e Reels, segundos sem ação no começo derrubam a retenção.
- `gameplay intro` gera as intros para você conferir.

## Entrega para a sua skill de postagem

Com `postagem: "skill"` (o padrão), cada corte aprovado é copiado para `pastaEntrega` (padrão `~/Gameplay/prontos`):

```
prontos/<linha>/<sessão>_<corte>/
  video.mp4    o formato escolhido
  capa.jpg
  legenda.txt  texto pronto para TikTok, Instagram e Facebook
  post.json    título, descrição, hashtags, gancho, legendas por rede (YouTube com título e descrição),
               linha (perfil, redes, horários), @, formato, nota, duração, crédito
```

O `post.json` é escrito por último: se ele existe, a pasta está completa. O corte passa a "entregue" no painel. Com `postarAutomatico`, o filtro de qualidade aprova sozinho antes da entrega. O `gameplay observar` entrega a cada 5 minutos, e `gameplay postar` entrega na hora.

Para a postagem ser feita aqui pelo Upload-Post, use `postagem: "upload-post"`.
