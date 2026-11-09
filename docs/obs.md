# Configurar o OBS no MacBook Air M4

Faça uma vez. Depois é só abrir o OBS, clicar em **Iniciar gravação** (ou transmitir e gravar) e jogar.

## Ligações

- PS5 → splitter HDMI → saída 1 na TV (você joga sem atraso) e saída 2 na placa AVerMedia BU110 → porta USB-C do Mac.
- GoPro (USB-C), microfone Fifine AM8 (USB), cabo de rede e carregador → hub Anker 555 → outra porta do Mac.
- PS5: Configurações → Sistema → HDMI → desligar **Ativar HDCP**. Ligado, a placa mostra tela preta.
- GoPro: instale o app **GoPro Webcam** e ligue a câmera no cabo. Ela aparece como webcam (até 1080p30).

## Configurações → Vídeo

| Campo | Valor |
|---|---|
| Resolução base e de saída | 1920x1080 |
| FPS | 60 |

## Configurações → Saída (modo Avançado) → Gravação

| Campo | Valor |
|---|---|
| Caminho | `~/Gameplay/inbox` |
| Formato | MP4 híbrido (`.mp4`) |
| Codificador | Apple VT HEVC (hardware) ou Apple VT H.264 |
| Controle de taxa | CRF / qualidade constante, ~ 60 |
| Faixas de áudio | marque 1, 2 e 3 |
| Nome do arquivo | padrão (`%CCYY-%MM-%DD %hh-%mm-%ss`) |

## Áudio avançado (engrenagem do mixer → Propriedades avançadas de áudio)

| Fonte | Faixa 1 | Faixa 2 | Faixa 3 |
|---|---|---|---|
| Microfone (Fifine) | ✔ | ✔ | |
| Placa de captura (som do PS5) | ✔ | | ✔ |

Faixa 1 é o som completo, a 2 só a sua voz (para a legenda), a 3 só o jogo (para achar explosões e gols).

Filtros no microfone: Supressão de ruído (RNNoise) → Compressor (razão 4:1, limiar -18 dB) → Limitador (-1 dB).

## Cenas

- **Jogando**: "Dispositivo de captura de vídeo" com a BU110 em tela cheia + "Dispositivo de captura de vídeo" com a GoPro no canto.
- **Só câmera** e **Pausa**: opcionais.

## Arquivos separados (recomendado)

Instale o plugin **Source Record** (obsproject.com → Plugins). Em cada fonte, adicione o filtro Source Record:

| Fonte | Caminho | Nome do arquivo |
|---|---|---|
| GoPro | `~/Gameplay/inbox` | `%CCYY-%MM-%DD %hh-%mm-%ss camera` |
| BU110 | `~/Gameplay/inbox` | `%CCYY-%MM-%DD %hh-%mm-%ss jogo` |

Modo de gravação: "Gravando" (grava junto com o botão principal). Assim o corte vertical usa a câmera inteira, sem recortar.

Sem o plugin funciona também: diga em `config.json` onde a câmera fica na cena, por exemplo
`"regiaoCamera": { "x": 1440, "y": 780, "w": 480, "h": 300 }`.

## Marcar momentos

- Fale **"clipa isso"** logo depois de uma jogada boa. O corte pega os 40 s antes.
- Ou defina uma tecla em Configurações → Teclas de atalho → **Adicionar marcador de capítulo** (precisa do MP4 híbrido).
  Um controle Bluetooth de selfie (R$ 20) pode apertar essa tecla.
