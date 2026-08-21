# Changelog

As mudanças notáveis do Hyperzettel são registradas neste arquivo. O formato
segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Added

- Os arquivos HTML standalone passam a exibir uma seção **Conexões** derivada, com direção da relação, título e link para a outra nota, motivos registrados nas duas pontas e ID como fallback. Os metadados `hz:connection` continuam sendo a fonte canônica das conexões de saída, e a apresentação permanece fora do conteúdo editável no round-trip.
- Adiciona o modelo **Nota de estudo**, com estrutura atômica para aula ou leitura e uma pergunta de recuperação pronta para o ciclo de revisão ativa.
- A Central do Vault passa a mostrar o estado do backup e recomendar uma exportação semanal; o menu global sinaliza discretamente quando o primeiro backup ou uma atualização está pendente.
- O backup JSON v3 passa a preservar e restaurar também as decisões de rejeitar relações semânticas, com validação e importação transacional; backups v1 e v2 continuam compatíveis.
- Primeiro ciclo guiado para vaults vazios: o usuário informa um assunto real e recebe uma nota de estrutura pronta para desenvolver perguntas, ideias e conexões.
- Orientação contextual repete captura, processamento e conexão até formar um primeiro conjunto com três ideias permanentes ligadas ao mapa.
- Notas de estrutura exibem uma seção derivada com as ideias conectadas e seus motivos, permitindo navegar pelo conjunto sem duplicar conteúdo entre arquivos.
- Destaque de texto na barra de formatação, persistido como `<mark>` no HTML da nota: o mesmo botão remove o destaque coberto pela seleção e uma seleção entre parágrafos gera uma marca por bloco.
- A Central do Vault ganha **Atualizar conexões**, que reescreve a seção de conexões de todos os arquivos desatualizados; arquivos alterados por fora são contados e pulados, sem interromper a varredura.
- Coloração de sintaxe nos blocos de código, com linguagem escolhida por bloco e 17 linguagens registradas. A cor é persistida no HTML da nota, então o arquivo avulso também abre colorido; o bloco é recolorido após uma pausa na digitação, preservando a posição do cursor.
- Bloco de código na barra de formatação: converte a seleção em `<pre><code>`, preserva quebras de linha ao colar, quebra linha com Enter e sai do bloco com um segundo Enter na linha vazia. O mesmo botão desfaz o bloco em parágrafos.

### Changed

- O corpo dos arquivos HTML passa a ser gravado com um bloco por linha, reduzindo ruído em diffs e sincronização; o CSS standalone é incluído por recurso usado, evitando reescrever notas sem código, tabelas, imagens ou conexões quando esses estilos mudam.
- A navegação passa a revelar processamento, pastas, estágios, mapa e revisão apenas quando o conteúdo do vault torna cada recurso útil.
- Autosave e maturidade deixam de competir na interface: conteúdo pendente é identificado como “Autosave pendente”, enquanto a ação principal passa a ser “Concluir nota” e o estado final, “Nota pronta”.
- Revisões agora exigem uma tentativa de recuperação antes de revelar o conteúdo e habilitar a avaliação; o atalho do editor abre esse fluxo em vez de registrar “lembrei bem” implicitamente.
- Notas podem guardar uma pergunta de recuperação própria no arquivo HTML; quando ela não existe, a revisão continua usando o título como pista.
- A fila de revisão passa a conter apenas notas vencidas e funciona como uma sessão finita, com abertura automática, avanço após cada avaliação, progresso e conclusão.

### Fixed

- Menus e diálogos aninhados não deixam mais o aplicativo sem responder a cliques depois de fechados: as camadas e guardas de foco do Radix passam a compartilhar uma única instância, o `Escape` fica com o overlay superior e os botões de fechar permanecem dentro de cada painel.
- O motivo de uma conexão volta a aceitar espaço enquanto é digitado no painel: o campo era controlado pelo valor já normalizado, que apara as pontas e apagava a tecla no render seguinte.
- A revisão iniciada pelo editor ou pelas propriedades agora espera a versão visível ser persistida; falha ou conflito mantém a pessoa no editor em vez de revisar conteúdo desatualizado.
- O cartão “Conexões” da tela inicial agora conta cada relação válida e não direcionada uma única vez, sem duplicar links recíprocos nem incluir auto-referências ou destinos ausentes.
- Depois que o primeiro ciclo é concluído, revisões vencidas e caixa de entrada voltam a ter prioridade no foco da tela inicial; a celebração permanece apenas quando não há trabalho recorrente pendente.
- A retenção média e a curva agora consideram somente notas concluídas e revisáveis; capturas e rascunhos continuam no grafo, e a ausência de uma amostra é exibida como “—” em vez de “0%”.
- O relógio de retenção de uma captura começa quando ela se torna uma nota concluída e revisável, evitando que rascunhos antigos nasçam atrasados; históricos de revisão existentes permanecem intactos.
- O atalho de revisão no editor agora abre uma sessão avulsa para a nota atual, mesmo quando ela ainda não venceu, sem misturá-la à fila automática de revisões pendentes.
- Estruturas intocadas de modelos continuam protegidas pelo autosave, mas não podem mais ser concluídas ou entrar na revisão como se fossem conteúdo escrito pelo usuário.
- Uma captura promovida para nota permanente continua no fluxo até os passos de conexão e conclusão, em vez de desaparecer ao sair da caixa de entrada.
- O seletor de conexões abre dentro do processamento e persiste o motivo informado sem desmontar a tela atual.
- A Central do Vault permite resolver IDs duplicados escolhendo qual arquivo preserva a identidade original; as demais cópias recebem IDs novos sem perder conteúdo.
- Um vault vazio ou um ID de sessão já removido deixa de produzir um falso erro de armazenamento durante a inicialização.
- Falhas parciais do índice após salvar ou excluir são reparadas automaticamente a partir dos arquivos HTML, sem duplicar notas nem exigir reinício.

## [0.8.0] - 2026-07-24

### Changed

- **Persistência das notas como arquivos**: cada nota agora é um arquivo `.html` auto-contido num vault em disco (fonte da verdade), em vez de ficar no IndexedDB do webview (ADR 0006). Os arquivos são portáteis, versionáveis e abríveis em qualquer navegador.
- As **imagens** passam a ser embutidas em base64 no próprio HTML da nota (auto-contido), em vez de um armazenamento separado.
- O **SQLite nativo** vira o armazenamento operacional de metadados, busca FTS5, conexões e retenção. As projeções das notas são reconstruíveis a partir do vault; o histórico de revisão continua exigindo backup.
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
