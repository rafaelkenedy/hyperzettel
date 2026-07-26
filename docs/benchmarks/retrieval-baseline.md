# Benchmark de recuperação de relações

Este benchmark compara três estratégias para sugerir relações entre notas:

1. **FTS5 lexical:** seleciona até 16 termos por TF-IDF da nota de origem e
   ordena os resultados com BM25, dando peso maior ao título;
2. **EmbeddingGemma:** compara os embeddings normalizados das notas completas
   com produto escalar;
3. **RRF híbrido:** combina os rankings lexical e semântico por Reciprocal Rank
   Fusion, com `k = 60`.

As conexões manuais formam o ground truth. Cada conexão é tratada como uma
aresta não direcionada; o texto, o motivo e a existência da conexão nunca
entram nos algoritmos de recuperação.

## Executar

O corpus padrão é `src/seed/cs50-notes.json`. Ele possui 57 notas e 157 arestas
manuais únicas.

```powershell
cd src-tauri
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
```

Para avaliar notas reais sem colocá-las no repositório, exporte um backup JSON
pelo aplicativo e informe seu caminho:

```powershell
$env:HYPERZETTEL_RETRIEVAL_FIXTURE = "C:\caminho\hyperzettel-notas-2026-07-26.json"
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
Remove-Item Env:HYPERZETTEL_RETRIEVAL_FIXTURE
```

O benchmark aceita tanto o array legado de notas (`links`) quanto o backup
atual (`notes[].connections`) e um diretório de arquivos `.html` do vault. A
saída contém somente métricas agregadas e uma linha JSON legível por automação;
nenhum conteúdo ou título é impresso.

### Vault multidomínio reproduzível

O blueprint `src/seed/retrieval-benchmark-vault.json` cobre seis domínios com
vocabulário variado: arquitetura local-first, aprendizagem, jardinagem,
finanças, culinária e engenharia de software. Para materializar documentos
HTML reais no mesmo envelope usado pelo aplicativo:

```powershell
npm run benchmark:vault:prepare
$env:HYPERZETTEL_RETRIEVAL_FIXTURE = "$PWD\.benchmark-vault"
cd src-tauri
cargo test --release --test benchmark_retrieval benchmark_lexical_semantic_and_hybrid_retrieval -- --ignored --nocapture
```

O diretório `.benchmark-vault/` é local e ignorado pelo Git. Os 25 arquivos
recebem UUIDs e nomes determinísticos, metadados `hz:*` e conexões manuais.

## Métricas

- **Hit@5:** proporção de notas com ao menos uma relação manual recuperada nas
  cinco primeiras sugestões;
- **Precision@5:** fração das cinco sugestões que corresponde a relações
  manuais;
- **Recall@20:** fração das relações manuais recuperada nos 20 candidatos;
- **MRR@20:** inverso médio da posição da primeira relação correta;
- **nDCG@5:** qualidade da ordenação das relações corretas nas cinco primeiras;
- **latência:** tempo de ranking com índices já construídos. Carga do modelo e
  geração dos embeddings são informadas separadamente.

O ranking semântico não aplica o limiar de produção `0,68`: o objetivo é medir
a qualidade comparável dos primeiros 20 candidatos, não reproduzir a decisão
final do pipeline.

## Baseline de 2026-07-26

Execução Windows em build `--release`, com a fixture CS50 versionada:

| Estratégia | Hit@5 | Precision@5 | Recall@20 | MRR@20 | nDCG@5 | Média | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FTS5 lexical | 0,807 | 0,337 | 0,592 | 0,640 | 0,396 | 0,604 ms | 0,825 ms |
| EmbeddingGemma | 0,789 | 0,305 | 0,559 | 0,650 | 0,377 | 0,025 ms | 0,028 ms |
| RRF híbrido | **0,877** | **0,358** | **0,600** | **0,653** | **0,422** | 0,712 ms | 1,435 ms |

Preparação observada:

- índice FTS5: 5,5 ms;
- carga do modelo: 4,98 s;
- embeddings das 57 notas: 62,60 s.

Nesta fixture, o lexical supera o vetor isolado em todas as métricas exceto
MRR@20. A fusão oferece o melhor resultado geral por menos de 2 ms no p95
depois que os embeddings existem. Isso sustenta testar um gerador híbrido de
candidatos, sem tornar embeddings a fonte exclusiva das relações.

## Baseline multidomínio de 2026-07-26

Execução sobre os 25 arquivos HTML reais materializados, com 42 arestas manuais
únicas:

| Estratégia | Hit@5 | Precision@5 | Recall@20 | MRR@20 | nDCG@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| FTS5 lexical | 0,440 | 0,160 | 0,339 | 0,346 | 0,229 |
| EmbeddingGemma | **0,960** | **0,416** | **1,000** | **0,906** | **0,684** |
| EmbeddingGemma ≥0,68 | **0,960** | 0,408 | 0,889 | **0,906** | 0,676 |
| RRF híbrido | 0,880 | 0,360 | **1,000** | 0,607 | 0,499 |
| RRF híbrido + limiar | 0,880 | 0,392 | 0,915 | 0,628 | 0,539 |

Preparação observada:

- índice FTS5: 2,4 ms;
- carga do modelo: 4,45 s;
- embeddings das 25 notas: 10,75 s.

Neste corpus, títulos e textos relacionados usam formulações diferentes. O
EmbeddingGemma isolado supera com folga tanto o lexical quanto o RRF de pesos
iguais. O limiar de produção mantém Hit@5 e MRR, reduzindo sobretudo candidatos
mais distantes no top 20.

As duas baselines demonstram que não existe vencedor universal: o híbrido ajuda
no corpus homogêneo e estruturado, mas degrada o multidomínio. A decisão atual é
**não trocar o pipeline de produção por RRF**. FTS5 continua sendo a busca
explícita do usuário e EmbeddingGemma continua responsável pela descoberta
automática de relações.

## Limitações

- Uma ausência de conexão não prova irrelevância; precision e nDCG subestimam
  resultados úteis ainda não conectados pelo autor.
- O corpus é pequeno, de um único domínio e contém títulos estruturados por
  semanas do CS50. O corpus multidomínio reduz essa limitação, mas ainda é
  controlado e não substitui avaliação com uso longitudinal.
- A consulta lexical é derivada de uma nota inteira. Este benchmark avalia
  descoberta de relações nota→nota, não perguntas livres digitadas pelo usuário.
- Latências dependem da máquina. Métricas de qualidade são a parte mais útil
  para comparar versões, modelos e estratégias.
- Alterar seleção de termos, pesos BM25, `RRF_K`, preparação semântica ou corpus
  exige registrar uma nova baseline; não se deve ajustar parâmetros e reportar
  o mesmo corpus como validação independente.
