# Changelog

As mudanças notáveis do Hyperzettel são registradas neste arquivo. O formato
segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.7.1] - 2026-07-24

### Security

- Define uma Content Security Policy restritiva na janela do aplicativo (antes ausente), como defesa em profundidade ao renderizar HTML de notas.
- Adiciona varredura de dependências (`npm audit` e `cargo audit`) e de segredos (gitleaks) à verificação de CI.

### Added

- Publica a licença do código-fonte sob **MIT** (`LICENSE`), com `NOTICE.md` esclarecendo que o modelo EmbeddingGemma segue os termos próprios do Google.
- Adiciona `SECURITY.md` (política de divulgação) e registros de decisão de arquitetura em `docs/adr/` (0001–0005).
- Adiciona verificação de cobertura de testes e um teste de acessibilidade (axe-core) na suíte.

## [0.7.0] - 2026-07-21

### Added

- Disponibiliza um aplicativo instalável para Windows com captura, processamento e organização de notas pelo método Zettelkasten.
- Adiciona editor, conexões justificadas, backlinks, mapa de conhecimento e revisão espaçada.
- Permite importar e exportar backups JSON com notas, imagens e histórico de aprendizagem.
- Gera relações semânticas no próprio computador com o modelo EmbeddingGemma incluído no instalador.
- Mantém notas, imagens, embeddings e relações nos bancos locais do aplicativo.
