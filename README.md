# gameplay-auto

Você joga; a plataforma faz os cortes. O OBS grava a sessão numa pasta do Mac, e cada gravação nova vira de 3 a 8 cortes
verticais (câmera em cima, jogo embaixo, legenda palavra por palavra, gancho nos primeiros segundos) com título,
descrição e hashtags, prontos para TikTok, Reels e Shorts.

Plano completo: [Ecossistema automático de vídeos de gameplay](https://claude.ai/artifact/AB8V9mzKECfrBrhWFWhRwN).

## Instalar (MacBook)

```sh
sh tools/instalar-mac.sh     # ffmpeg, whisper.cpp, modelo de transcrição, pastas em ~/Gameplay
```

Depois configure o OBS seguindo [docs/obs.md](docs/obs.md). Para títulos e escolha dos cortes com IA, deixe
`ANTHROPIC_API_KEY` no ambiente (ou rode `ant auth login`). Sem ela, a plataforma funciona com títulos padrão.

## Usar

```sh
npm run observar                                  # fica de olho em ~/Gameplay/inbox e processa cada gravação
npm run processar -- "~/Gameplay/inbox/2026-11-09 21-30-00.mp4"   # uma sessão agora
```

Os cortes saem em `~/Gameplay/cortes/<sessão>/`, com `sessao.json` (títulos, notas, status de cada corte).

## Como escolhe os momentos

1. **Comando de voz**: quando você fala "clipa isso", o corte pega os 40 s antes.
2. **Marcador do OBS**: a tecla "Adicionar marcador de capítulo".
3. **Reação no microfone**: grito ou risada acima do normal da sessão.
4. **Pico de som do jogo**: explosão, gol, torcida.
5. **Falas de emoção**: "não acredito", "meu deus", "caraca", "kkkk"...

O Claude lê a transcrição de cada candidato, acerta início e fim, dá nota, escreve o gancho e o título. Os melhores viram vídeo.

## Código

| Arquivo | O que faz |
|---|---|
| `src/sessao.js` | o fluxo de uma sessão, do arquivo ao `sessao.json` |
| `src/observador.js` | observa a pasta do OBS e espera a gravação terminar |
| `src/transcricao.js` | whisper.cpp, uma entrada por palavra |
| `src/momentos.js` | candidatos: comando de voz, marcadores, volume, falas |
| `src/ia.js` | Claude decide os cortes e escreve os textos |
| `src/corte.js` + `src/legenda.js` | render vertical com ffmpeg e legenda ASS (adaptado do projeto afiliado) |
| `src/longo.js` | vídeo completo do YouTube, capítulos e thumbnail |
| `src/painel.js` + `public/painel.html` | painel de aprovação |
| `src/postagem.js` | agenda nas redes pelo Upload-Post |

Testes: `npm test`.

## Aprovar no celular

`npm run observar` também abre o painel. No celular, no mesmo Wi-Fi, abra o endereço que aparece no terminal
(ex.: `http://192.168.0.10:4321`). Cada corte tem o vídeo, título, descrição e hashtags editáveis e os botões
Aprovar e Descartar. Para ninguém mais da rede abrir, ponha `"senhaPainel": "..."` no `config.json` e abra uma vez com `/?senha=...`.

## Postar

Os cortes aprovados vão para o próximo horário de pico (12:00, 18:30 e 21:00 de Brasília) no TikTok, Reels e YouTube
Shorts de uma vez, pelo [Upload-Post](https://upload-post.com) (plano Basic, US$ 16/mês; o TikTok exige um app auditado e esse já é).

1. Crie a conta no Upload-Post, em **Manage Users** crie um perfil e conecte TikTok, Instagram (conta profissional) e YouTube.
2. No `config.json`: `"uploadPost": { "perfil": "nome-do-perfil" }`.
3. No terminal antes de rodar: `export UPLOAD_POST_API_KEY=...` (ou no `~/.zshrc`).

Com `"postarAutomatico": true` (piloto automático) ninguém aprova: cada corte passa pelo filtro (`"filtro"`: nota mínima 8,5,
duração de 12 a 75 s, título e gancho; terceiros só com permissão registrada e `terceiros.automatico`). O que passa é
agendado, o que não passa é descartado com o motivo escrito no corte. Se uma plataforma recusar um post (403, conta
suspensa, direitos autorais) ou houver 3 erros seguidos, toda a postagem pausa até você tocar em **Retomar** no painel.
O volume por dia de cada linha é o número de horários dela.

## Várias contas (linhas)

Com `"linhas"` no `config.json` (modelo em `config.example.json`), cada linha é um perfil do Upload-Post com suas redes e
horários: FNANDO, FNANDO Shorts, FNANDO Resenha, FNANDO Dicas e CLIPAÍ. Cada corte vai para **uma** linha só: o melhor
para a principal e os seguintes em rodízio entre as linhas automáticas. No painel dá para trocar a linha antes de aprovar.
Dicas e CLIPAÍ não recebem cortes da live; corte de terceiros leva crédito na legenda. Facebook entra como Reels (`facebookPage` na linha se o perfil tiver mais de uma página).
O vídeo longo vai para `longo.perfil`. Sem `linhas`, vale o `uploadPost` de antes (uma conta só). Plano da operação: `docs/canais.md`.

## Escritório

`/escritorio` no painel mostra o pipeline como um escritório em pixel art: cada etapa (Vigia, Escriba, Caçador de lances,
Roteirista IA, Editor, Montador, você, Agendador, Clipador, Analista) num personagem com o estado real, a fila de cada linha
e os últimos acontecimentos. O estado fica em `<pastaSaida>/.escritorio.json`.

## Marca

Logos, avatares, banners, modelos de thumbnail e overlay do OBS em `docs/marca/` (PNG) e `public/marca/` (SVG).
Para gerar de novo: `pip install fonttools cairosvg && python3 tools/marca/gerar.py`.

## Vídeo completo do YouTube

Cada sessão também vira `youtube-completo.mp4`: abre com os 10 s do melhor momento, trechos longos sem fala
(mais de 20 s, ajuste em `silencioMax`) encolhem para 4 s, os momentos ficam inteiros, os capítulos vão para a descrição
e a thumbnail sai do melhor quadro com o gancho em letras grandes. Ele aparece no painel; aprovado, vai só para o
YouTube às 19:00.
