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

## Dinamismo (sem câmera)

- **Título fixo**: o gancho fica em cima o vídeo todo (`estilo.ganchoSeg`; use `2.5` para só os primeiros segundos). A IA escreve como curiosidade ou pergunta ("DÁ ATÉ PRA...", "O JASON TEM O PODER DO FRANKLIN?").
- **Corte seco nas pausas**: pausa na fala maior que 1,6 s vira 0,45 s (`cortarSilencio: { maxGap, fica }`; `false` desliga). Corte sem fala fica inteiro.
- **Zoom com tremida e whoosh**: nas reações o jogo dá um zoom de 0,9 s com uma tremida leve, e cada mudança de enquadramento toca um whoosh (`efeitos.whoosh: false` desliga). Minimapa: veja `docs/ao-vivo.md`.
- **Séries "Parte N"**: a IA diz se o corte é de uma série ("Coisas que dá pra fazer no GTA 6"); a plataforma numera (contadores em `<pastaSaida>/.series.json`), escreve "(Parte N)" no título e um selo amarelo "PARTE N" em cima do vídeo.
- **Sem câmera**: `temCamera: false` (padrão até ligar a webcam) faz só os formatos de jogo.

## Volume seguro

Cada conta posta no máximo `limites` por dia (padrão: TikTok 4, Instagram 3, YouTube 4, Facebook 3), nos horários de pico da linha. O `post.json` leva `agendarPara` com o horário que a sua skill deve publicar. Acima disso as redes tratam como spam (alcance zero, "conteúdo não original", bloqueio de postagem). Para postar mais, crie mais contas (linhas), sem repetir o mesmo corte em duas contas.

## Vídeo por missão (YouTube)

Além do vídeo da sessão inteira, cada missão vira um vídeo longo (`src/missoes.js`): a IA olha um quadro a cada 6 s e marca onde a missão começa (nome ou "CAPÍTULO N" na tela, ligação, objetivo novo) e termina (missão concluída, última cena). O trecho é cortado sem recodificar (rápido), ganha thumbnail, título, descrição com capítulos e tags, e aparece na aba **Vídeo longo** e em **Aprovar cortes**. Missão com nudez ou violência explícita na tela vem com aviso. Aprovado, vai para `prontos/youtube-longo/`. `missoes: false` desliga; `{ "passo": 6, "minSeg": 150 }` ajusta. Precisa da IA.

## TikTok pelo Chrome (extensão)

O TikTok posta pela extensão **FNANDO: TikTok pelo Chrome** (pasta `extensao-tiktok/`), sem API do TikTok e sem serviço pago. A cada 2 minutos ela pergunta à central (`http://localhost:4322/api/tiktok-chrome/proximo`) se há corte de uma linha com TikTok já entregue em `prontos/`, com `agendarPara` vencido e ainda sem link do TikTok no `postado.json`. Quando há, abre o TikTok Studio numa janela própria, anexa o `video.mp4`, digita a legenda (título, descrição, crédito e hashtags, até 2.200 caracteres), clica em **Publicar** e conta o resultado. A central grava `links.tiktok` no `postado.json` (os links das outras redes ficam). Com o freio puxado (`.pausa.json`) ela não entrega nada.

Para carregar (uma vez, no Chrome logado no TikTok @fnando.gameplay):

1. Deixe o painel rodando (`npm run painel` ou `npm run observar`).
2. Em `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `extensao-tiktok` deste projeto.
3. Na central, aba **Contas** > cartão do TikTok > **Mostrar código** (só abre no próprio Mac). Copie.
4. Clique no ícone da extensão, cole o código e **Salvar e conferir agora**.

O código fica em `~/Gameplay/.tiktok-chrome-token` (fora do git). Apagar o arquivo e reiniciar o painel gera outro, e a extensão precisa do novo. Se parar antes de clicar em Publicar, tenta mais uma vez 15 minutos depois. Depois do clique, nunca manda de novo (para não postar duas vezes), e o erro fica em `.tiktok-chrome.json` na pasta do corte. Se o TikTok mudar a página do Studio, os seletores estão em `extensao-tiktok/studio.js`.

## Postagem automática pelas APIs oficiais (Instagram, Página do Facebook, YouTube)

Com `postadorLigado: true`, o painel (e o `observar`) roda o postador a cada 5 minutos (`src/postador.js`). Ele pega **um** post entregue em `prontos/` com `agendarPara` vencido e publica em **uma** rede que ainda falta: Instagram Reels e Reels da Página pela Graph API (o arquivo sobe direto do Mac, sem link público), e YouTube Shorts (e os vídeos longos e de missão) pela YouTube Data API. O TikTok continua pela extensão do Chrome. Os links vão para `postado.json` (`links` e `emRede`), sem apagar os das outras redes. Cada rede respeita o limite seguro por dia (`limites`). Post com `aviso` (nudez ou violência na tela) nunca sai sozinho, e trechos listados em `trechosBloqueados` nunca passam no filtro automático.

Erro grave da plataforma (bloqueio, política, strike) puxa o freio (`.pausa.json`) para tudo. Token vencido para só aquela rede, até conectar de novo. Falha comum tenta de novo em 15 min, 1 h e 6 h, e para depois de 3 tentativas.

Para conectar (uma vez, no próprio Mac, em http://localhost:4322/#contas):

1. **Meta**: cole a chave secreta do app (developers.facebook.com > app FNexus Publicador > Configurações > Básico) e clique em **Conectar Instagram e Página**. Escolha a Página Fnando e o Instagram @fnando.gameplay.
2. **YouTube**: cole a chave secreta do cliente OAuth do Google e clique em **Conectar YouTube**, com a conta fnando.gameplay@gmail.com.

As chaves e os tokens ficam só em `~/Gameplay/.credenciais.json` (permissão 600, fora do git). Os ids das playlists do YouTube ficam em `config.json` > `youtube.playlists` (`shorts`, `curiosidades`, `dicas`, `missoes`). Cada Short entra em Shorts e em Dicas ou Curiosidades (pelo título e pelas hashtags), cada missão em Missões completas, e a sessão inteira em nenhuma.
