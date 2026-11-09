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

Testes: `npm test`.

## Próximos passos

- Painel de aprovação no celular (aprovar, refazer, descartar)
- Postagem: YouTube e Shorts (API oficial), TikTok (Upload-Post), Instagram Reels (API do Instagram)
- Vídeo longo do YouTube: sessão editada sem tempo morto, capítulos e thumbnail
