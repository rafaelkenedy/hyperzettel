# Relações semânticas

Este documento registra os limites do pipeline de relações semânticas que não
ficam evidentes em um único módulo. Valores e hashes têm como fontes de verdade
`config.rs` e `model-manifest.json`.

## Fluxo

1. O frontend envia ao Tauri um espelho das notas persistidas.
2. Uma fila Rust deduplica revisões e processa uma nota por vez.
3. FastEmbed executa o EmbeddingGemma localmente pelo ONNX Runtime.
4. O serviço compara o vetor com os embeddings ativos e persiste as relações.
5. Eventos Tauri atualizam o progresso e as sugestões na interface.

Notas arquivadas ou removidas saem do índice. Salvar não espera a inferência
terminar. O modo web não executa esse pipeline.

## Modelo e busca

O instalador inclui a variante Q4 do
`onnx-community/embeddinggemma-300m-ONNX`, o tokenizer e as licenças. A build
e o carregamento conferem o manifesto e os hashes antes de usar esses arquivos.

O pipeline limita a entrada a 2.048 tokens, reduz a saída de 768 para 256
dimensões e normaliza o vetor persistido. A busca atual usa produto escalar
linear, avalia até 20 candidatos, exige similaridade mínima de `0,68` e mantém
até cinco sugestões por nota.

Alterar o modelo, a preparação do texto, as dimensões ou a estratégia de
normalização exige uma nova `pipeline_version`. Isso força a reconstrução do
índice em vez de reutilizar vetores incompatíveis.

## Persistência

O vault de arquivos HTML é a fonte da verdade das notas e imagens inline. O
arquivo `hyperzettel.sqlite`, no diretório de dados do aplicativo, mantém:

- o espelho de notas usado pelo backend;
- embeddings e relações automáticas;
- relações rejeitadas;
- o checkpoint da fila de indexação.

O hash do conteúdo evita inferência quando a nota e a versão do pipeline não
mudaram. Editar uma nota invalida somente seu vetor. A substituição das
sugestões automáticas não remove conexões manuais.

Embeddings, relações automáticas e o checkpoint são reconstruíveis. Rejeições
de sugestões representam uma decisão do usuário, não derivável do vault, e o
backup JSON v3 as exporta e restaura em lote. Backups anteriores continuam
válidos e simplesmente não carregam essas decisões. Essa distinção e os
critérios de recuperação estão no
[ADR 0006](adr/0006-html-per-note-persistence.md).

## Limite offline

O aplicativo instalado não busca modelo, tokenizer ou pesos na rede. Esses
arquivos são recursos do bundle.

A preparação de um clone ainda requer rede para instalar dependências npm e
Cargo. A feature `ort-download-binaries-rustls-tls` também obtém o binário de
build do ONNX Runtime durante a compilação, não durante o uso do aplicativo.

## Verificação

```powershell
cd src-tauri
cargo test
cargo test real_pipeline_reuses_cache_and_updates_incrementally -- --ignored --nocapture
cargo test benchmark_embeddinggemma --release -- --ignored --nocapture
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
```

O primeiro comando cobre o contrato sem carregar o modelo completo. Os demais
validam inferência e benchmarks com os recursos reais. O protocolo e a baseline
da comparação FTS5 × EmbeddingGemma × híbrido estão em
`docs/benchmarks/retrieval-baseline.md`.

## Limitações atuais

- A busca é linear e carrega os embeddings ativos em memória.
- Entradas acima de 2.048 tokens são truncadas; não há embeddings por seção.
- O pipeline nativo e o instalador são validados apenas no Windows.
