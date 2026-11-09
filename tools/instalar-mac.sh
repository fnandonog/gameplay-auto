#!/bin/sh
# Instala no Mac o que a plataforma usa: ffmpeg, whisper.cpp e o modelo de transcrição, Node e as pastas.
set -e
command -v brew >/dev/null || { echo "Instale o Homebrew primeiro: https://brew.sh"; exit 1; }
brew install ffmpeg whisper-cpp node
mkdir -p "$HOME/Gameplay/inbox" "$HOME/Gameplay/cortes" "$HOME/Gameplay/gravacoes" "$HOME/Gameplay/modelos"
MODELO="$HOME/Gameplay/modelos/ggml-large-v3-turbo.bin"
if [ ! -f "$MODELO" ]; then
  echo "Baixando o modelo do Whisper (1,6 GB, uma vez só)..."
  curl -L -o "$MODELO" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
fi
cd "$(dirname "$0")/.." && npm install
[ -f config.json ] || cp config.example.json config.json
echo "Pronto. Configure o OBS (docs/obs.md) e rode: npm run observar"
