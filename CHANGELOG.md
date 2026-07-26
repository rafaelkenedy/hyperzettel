# Changelog

As mudanças notáveis do Hyperzettel são registradas neste arquivo. O formato
segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- Primeiro ciclo guiado para vaults vazios: o usuário informa um assunto real e recebe uma nota de estrutura pronta para desenvolver perguntas, ideias e conexões.

### Changed

- A navegação passa a revelar processamento, pastas, estágios, mapa e revisão apenas quando o conteúdo do vault torna cada recurso útil.

## [0.8.0] - 2026-07-24

### Changed

- **Persistência das notas como arquivos**: cada nota agora é um arquivo `.html` auto-contido num vault em disco (fonte da verdade), em vez de ficar no IndexedDB do webview (ADR 0006). Os arquivos são portáteis, versionáveis e abríveis em qualquer navegador.
- As **imagens** passam a ser embutidas em base64 no próprio HTML da nota (auto-contido), em vez de um armazenamento separado.
- O **SQLite nativo** vira o índice derivado obrigatório (metadados + busca FTS5 + conexões + retenção), reconstruível a partir do vault; a busca deixa de reparsear HTML a cada tecla.
- A **revisão espaçada** (painel Aprendizagem) só aparece quando a nota deixou de ser fugaz — revisar uma captura crua não fazia sentido no ciclo do Zettelkasten.

### Added

- Reconciliação na inicialização por nome e SHA-256: se o índice não reflete os arquivos do vault (arquivo editado, renomeado, adicionado ou removido; vault sincronizado; índice apagado), ele é reconstruído a partir dos arquivos — a fonte da verdade.
- **Central do Vault** no menu do aplicativo: mostra a localização e o tamanho do vault, abre a pasta no Explorer, verifica conflitos sem alterar arquivos, reconstrói o índice e permite adotar com segurança um HTML externo sem `hz:id`, preservando seu nome.
- Editor: tabelas, títulos H4–H6 e linha divisória (`<hr>`) na barra de formatação, com a allowlist do sanitizer ampliada.
- Benchmark reproduzível de recuperação de relações, comparando FTS5 lexical, EmbeddingGemma e fusão RRF híbrida contra conexões manuais, com suporte ao corpus versionado e a backups locais.
- Gerador de vault HTML multidomínio para validar o benchmark no contrato físico real das notas, sem depender de dados pessoais.

### Removed

- Armazenamento legado em IndexedDB e a rotina de migração associada. Como não há base instalada, a persistência é exclusivamente o vault de arquivos desde a primeira execução.

### Fixed

- "Retomar de onde parou" (tela inicial): clicar em uma nota que já estava aberta não abria nada — a tela não trocava para o editor. Agora navega para a nota mesmo quando ela já está carregada.
- "Adicionar conexão" mostrava o glifo de atalho do Mac (⌘⇧K) mesmo no Windows; agora usa o atalho da plataforma (Ctrl+Shift+K).
- Arquivos HTML criados ou renomeados manualmente podem usar qualquer nome seguro; o `hz:id` interno identifica a nota, e abrir, salvar ou excluir não exige mais um arquivo chamado `<id>.html`.
- Notas novas recebem um nome externo legível no formato `<timestamp>--<titulo>--<id-curto>.html`; colisões ampliam automaticamente o trecho do ID sem sobrescrever outro arquivo.
- Uma gravação repetida após falha do índice reutiliza o arquivo que já declara o mesmo `hz:id`, sem criar duplicatas.
- Arquivos sem `hz:id` ou com IDs duplicados são reportados e excluídos do índice, em vez de colapsarem silenciosamente.
- Edições externas concorrentes não são sobrescritas: o hash divergente bloqueia a gravação e mantém o rascunho no editor.

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
