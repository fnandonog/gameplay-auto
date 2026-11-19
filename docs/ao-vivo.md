# Cortes quase ao vivo

A plataforma corta enquanto você joga. Não dá para cortar o que ainda está sendo gravado (o arquivo do OBS só fica
pronto quando fecha), então o OBS grava em blocos curtos e cada bloco vira cortes assim que fecha. Um momento sai
como corte uns 5 a 8 minutos depois de acontecer.

## No OBS (uma vez)
1. **Configurações > Saída > Gravação**: marque **Dividir arquivo automaticamente**, **Dividir por tempo**, **5 min**.
2. **Configurações > Saída > Buffer de replay**: ligue, **60 s**. Em **Atalhos**, ponha **Salvar replay** em **Ctrl+S**.
   Quando acontecer algo bom, aperte Ctrl+S: os últimos 60 s viram um corte sozinho (o arquivo "Replay ..." cai na mesma pasta).
3. Inicie o buffer de replay junto com a gravação ou a live.

## Na plataforma (`config.json`)
```json
"aoVivo": { "ligado": true, "cortesPorBloco": 2, "whisper": { "modelo": "~/Gameplay/modelos/ggml-small.bin" } }
```
- `cortesPorBloco`: quantos cortes cada bloco de 5 min pode dar (padrão 2).
- `whisper.modelo`: um modelo mais leve durante a live, para o Mac não engasgar a transmissão. Baixe com
  `sh tools/instalar-mac.sh` ou pegue o `ggml-small.bin` do whisper.cpp.
- Sem live, deixe `"ligado": false` e a gravação inteira vira cortes + vídeo longo no final.

## Limites
- Um momento que cai bem na virada de um bloco pode sair cortado. O Ctrl+S (replay) resolve esses.
- Durante a live o Mac faz três coisas ao mesmo tempo (OBS, transcrição e montagem). No MacBook Air M4 dá, com o
  modelo leve e o OBS gravando em H.264 por hardware (Apple VT). Se a live engasgar, suba os blocos para 10 min.
- O vídeo longo do YouTube não sai no modo ao vivo (cada bloco é separado).

## Enquadramento automático
Nos formatos só jogo (`jogo`, `jogocheio`):
- Quando você fala "minimapa", "no mapa", "canto do mapa", "radar" ou "GPS", o corte vai para o minimapa por 3 s.
- Nas reações ("bizarro", "olha", "caraca", "nossa", "insano", "doideira"...), o jogo dá um zoom rápido (1,25x por 0,9 s), no máximo um a cada 3 s.
- `"enquadramento": false` desliga tudo; `{ "reacoes": false }` deixa só o minimapa; `{ "minimapa": { "x": 20, "y": 830, "w": 340, "h": 230 } }` muda onde fica o minimapa (em pixels de uma tela 1920x1080).
