# Operação FNANDO + CLIPAÍ

Plano completo (lives, cortes, reedição, horários, regras para terceiros e checklist):
https://claude.ai/artifact/WNj2Jd6W5xZERK3QgPCF5Z

Resumo para quem mexe no código:

| Linha | Perfil Upload-Post | Redes | Entra como |
| --- | --- | --- | --- |
| FNANDO | `fnando` | TikTok, Instagram (+ YouTube longo via `longo.perfil`) | automático |
| FNANDO Shorts | `fnando-shorts` | YouTube Shorts, TikTok, Instagram | automático |
| FNANDO Resenha | `fnando-resenha` | TikTok, Instagram | automático |
| FNANDO Dicas | `fnando-dicas` | YouTube, TikTok | manual (não recebe corte da live) |
| CLIPAÍ | `clipai` | YouTube, TikTok, Instagram | só streamers com permissão; nunca auto-aprovado |

- Um corte, uma linha (`src/canais.js`). Repostar o mesmo corte em várias contas nossas derruba alcance e pode marcar as contas como inautênticas.
- Corte de terceiros leva `credito: { streamer, link }` e a legenda ganha "Crédito: ...".
- `terceiros.fontes[].permissao` vazio = o Clipador não trabalha.
