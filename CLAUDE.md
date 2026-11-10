# CLAUDE.md

Plataforma de cortes automáticos de gameplay do Fernando (PS5 + GoPro HERO13 + MacBook Air M4, OBS). Roda no Mac dele.
Plano e decisões: https://claude.ai/artifact/AB8V9mzKECfrBrhWFWhRwN. Setup do OBS: `docs/obs.md`.

- Node 20+, ESM, sem build. Dependência externa só `@anthropic-ai/sdk`; vídeo é ffmpeg, transcrição é whisper.cpp local.
- Partes puras (argumentos do ffmpeg, detecção de momentos, legenda) são exportadas e testadas: `npm test`.
- Código derivado do repositório `em-busca-do-afiliado-automatico` (projeto afiliado) é copiado e adaptado aqui; nunca alterar aquele repositório.
- Postagem nas redes começa "com aprovação"; modo automático só quando o dono ligar.
- Documentação e textos em português (pt-BR); código, identificadores e commits em inglês.
- Marca: FNANDO (amarelo #FFE600) e CLIPAÍ (ciano #00E0FF), decididas em 2026-11-10. Arte gerada por `tools/marca/gerar.py`.
- Cada corte vai para uma linha de contas só (`src/canais.js`). Cortes de terceiros (CLIPAÍ) só de quem autorizou por escrito e com crédito; no piloto automático só passam com `terceiros.automatico` e a permissão registrada.
- Piloto automático (`postarAutomatico`): o filtro de `src/qualidade.js` substitui a aprovação, e erro grave da plataforma pausa toda a postagem (`.pausa.json`) até o dono retomar.
- Toda etapa nova do pipeline chama `registrar()` (`src/atividade.js`) para aparecer no escritório.
