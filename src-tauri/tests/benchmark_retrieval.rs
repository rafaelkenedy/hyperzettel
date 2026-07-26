#![cfg_attr(target_os = "windows", allow(linker_messages))]

//! Benchmark de recuperação de relações entre notas.
//!
//! As conexões manuais do corpus são o ground truth. Para cada nota, o
//! benchmark tenta recuperar suas vizinhas com três estratégias:
//! SQLite FTS5 (lexical), EmbeddingGemma (semântica) e RRF (híbrida).

use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use fastembed::TextEmbedding;
use hyperzettel_lib::knowledge::{
    domain::{truncate_and_normalize, RELATION_CONFIG},
    infrastructure::{dot_product, normalize_semantic_text, prepare_note_text, ModelLoader},
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const FIXTURE_ENV: &str = "HYPERZETTEL_RETRIEVAL_FIXTURE";
const CANDIDATE_LIMIT: usize = 20;
const SUGGESTION_LIMIT: usize = 5;
const QUERY_TERM_LIMIT: usize = 16;
const RRF_K: f64 = 60.0;

#[derive(Debug, Deserialize)]
struct BenchmarkNote {
    id: String,
    title: String,
    content: String,
    #[serde(default)]
    links: Vec<String>,
    #[serde(default)]
    connections: Vec<BenchmarkConnection>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BenchmarkConnection {
    Id(String),
    Detailed { id: String },
}

impl BenchmarkConnection {
    fn id(&self) -> &str {
        match self {
            Self::Id(id) | Self::Detailed { id } => id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum BenchmarkFixture {
    Notes(Vec<BenchmarkNote>),
    Backup { notes: Vec<BenchmarkNote> },
}

#[derive(Debug)]
struct CorpusNote {
    id: String,
    lexical_title: String,
    lexical_content: String,
    semantic_text: String,
    relevant: HashSet<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RetrievalMetrics {
    strategy: String,
    queries: usize,
    hit_rate_at_5: f64,
    precision_at_5: f64,
    recall_at_20: f64,
    mrr_at_20: f64,
    ndcg_at_5: f64,
    average_latency_ms: f64,
    p95_latency_ms: f64,
}

struct LexicalIndex {
    connection: Connection,
    queries: HashMap<String, String>,
}

impl LexicalIndex {
    fn build(notes: &[CorpusNote]) -> Self {
        let mut connection = Connection::open_in_memory().expect("lexical benchmark database");
        connection
            .execute_batch(
                "CREATE VIRTUAL TABLE retrieval_benchmark USING fts5(
                    id UNINDEXED,
                    title,
                    content,
                    tokenize = 'unicode61 remove_diacritics 2'
                );",
            )
            .expect("FTS5 benchmark table");

        let transaction = connection.transaction().expect("FTS transaction");
        {
            let mut insert = transaction
                .prepare(
                    "INSERT INTO retrieval_benchmark (id, title, content)
                     VALUES (?1, ?2, ?3)",
                )
                .expect("FTS insert");
            for note in notes {
                insert
                    .execute(params![note.id, note.lexical_title, note.lexical_content])
                    .expect("index benchmark note");
            }
        }
        transaction.commit().expect("commit FTS corpus");

        Self {
            connection,
            queries: build_lexical_queries(notes),
        }
    }

    fn rank(&self, source_id: &str, limit: usize) -> Vec<String> {
        let Some(query) = self.queries.get(source_id) else {
            return Vec::new();
        };
        let mut statement = self
            .connection
            .prepare_cached(
                "SELECT id
                 FROM retrieval_benchmark
                 WHERE retrieval_benchmark MATCH ?1 AND id <> ?2
                 ORDER BY bm25(retrieval_benchmark, 0.0, 8.0, 1.0), id
                 LIMIT ?3",
            )
            .expect("FTS query");
        statement
            .query_map(params![query, source_id, limit as i64], |row| {
                row.get::<_, String>(0)
            })
            .expect("FTS rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("FTS ranking")
    }
}

struct SemanticIndex {
    ids: Vec<String>,
    vectors: HashMap<String, Vec<f32>>,
}

impl SemanticIndex {
    fn build(notes: &[CorpusNote], model: &mut TextEmbedding) -> Self {
        let inputs = notes
            .iter()
            .map(|note| note.semantic_text.clone())
            .collect::<Vec<_>>();
        let source_vectors = model
            .embed(&inputs, Some(RELATION_CONFIG.indexing_batch_size))
            .expect("embed retrieval corpus");
        let vectors = notes
            .iter()
            .zip(source_vectors)
            .map(|(note, vector)| {
                (
                    note.id.clone(),
                    truncate_and_normalize(&vector, RELATION_CONFIG.persisted_dimensions)
                        .expect("normalize benchmark embedding"),
                )
            })
            .collect();
        Self {
            ids: notes.iter().map(|note| note.id.clone()).collect(),
            vectors,
        }
    }

    fn rank(&self, source_id: &str, limit: usize) -> Vec<String> {
        self.rank_with_minimum(source_id, limit, f32::NEG_INFINITY)
    }

    fn rank_with_minimum(&self, source_id: &str, limit: usize, minimum_score: f32) -> Vec<String> {
        let source = self
            .vectors
            .get(source_id)
            .expect("source embedding in benchmark");
        let mut scores = self
            .ids
            .iter()
            .filter(|candidate| candidate.as_str() != source_id)
            .map(|candidate| {
                let score = dot_product(
                    source,
                    self.vectors
                        .get(candidate)
                        .expect("candidate embedding in benchmark"),
                )
                .expect("compatible benchmark embeddings");
                (candidate.clone(), score)
            })
            .filter(|(_, score)| *score >= minimum_score)
            .collect::<Vec<_>>();
        scores.sort_by(|left, right| {
            right
                .1
                .total_cmp(&left.1)
                .then_with(|| left.0.cmp(&right.0))
        });
        scores.into_iter().take(limit).map(|(id, _)| id).collect()
    }
}

fn default_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/seed/cs50-notes.json")
}

fn load_corpus() -> (PathBuf, Vec<CorpusNote>, usize) {
    let path = env::var_os(FIXTURE_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(default_fixture_path);
    let notes = if path.is_dir() {
        load_vault_notes(&path)
    } else {
        let source = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("não foi possível ler {}: {error}", path.display()));
        let fixture: BenchmarkFixture = serde_json::from_str(&source)
            .expect("fixture deve ser array de notas ou backup Hyperzettel");
        match fixture {
            BenchmarkFixture::Notes(notes) | BenchmarkFixture::Backup { notes } => notes,
        }
    };
    assert!(
        notes.len() >= 10,
        "benchmark precisa de pelo menos 10 notas"
    );

    let ids = notes
        .iter()
        .map(|note| note.id.clone())
        .collect::<HashSet<_>>();
    assert_eq!(ids.len(), notes.len(), "ids do corpus devem ser únicos");

    let mut relevant = ids
        .iter()
        .map(|id| (id.clone(), HashSet::new()))
        .collect::<HashMap<_, _>>();
    let mut edge_count = 0;
    for note in &notes {
        let linked_ids = note
            .links
            .iter()
            .map(String::as_str)
            .chain(note.connections.iter().map(BenchmarkConnection::id));
        for linked_id in linked_ids {
            if linked_id == note.id || !ids.contains(linked_id) {
                continue;
            }
            let inserted = relevant
                .get_mut(&note.id)
                .expect("source ground truth")
                .insert(linked_id.to_owned());
            relevant
                .get_mut(linked_id)
                .expect("target ground truth")
                .insert(note.id.clone());
            if inserted {
                edge_count += 1;
            }
        }
    }
    assert!(edge_count > 0, "corpus precisa de conexões manuais");

    let corpus = notes
        .into_iter()
        .map(|note| CorpusNote {
            id: note.id.clone(),
            lexical_title: normalize_semantic_text(&note.title),
            lexical_content: normalize_semantic_text(&note.content),
            semantic_text: prepare_note_text(&note.title, &note.content, &[]).value,
            relevant: relevant.remove(&note.id).expect("note ground truth"),
        })
        .collect();
    (path, corpus, edge_count)
}

fn load_vault_notes(directory: &Path) -> Vec<BenchmarkNote> {
    let mut paths = fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("não foi possível listar {}: {error}", directory.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("html"))
        })
        .collect::<Vec<_>>();
    paths.sort();

    paths
        .into_iter()
        .map(|path| {
            let html = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("não foi possível ler {}: {error}", path.display()));
            let id = extract_meta_values(&html, "id")
                .into_iter()
                .next()
                .unwrap_or_else(|| panic!("{} não declara hz:id", path.display()));
            let title = extract_between(&html, "<title>", "</title>")
                .map(decode_html)
                .unwrap_or_else(|| panic!("{} não declara <title>", path.display()));
            let content = extract_between(&html, r#"<article class="hz-prose">"#, "</article>")
                .unwrap_or_else(|| panic!("{} não contém .hz-prose", path.display()))
                .to_owned();
            let connections = extract_meta_values(&html, "connection")
                .into_iter()
                .map(|connection| {
                    let target = connection
                        .split_once('|')
                        .map_or(connection.as_str(), |(target, _)| target);
                    BenchmarkConnection::Id(target.to_owned())
                })
                .collect();
            BenchmarkNote {
                id,
                title,
                content,
                links: Vec::new(),
                connections,
            }
        })
        .collect()
}

fn extract_meta_values(html: &str, name: &str) -> Vec<String> {
    let marker = format!(r#"<meta name="hz:{name}" content=""#);
    let mut remaining = html;
    let mut values = Vec::new();
    while let Some(start) = remaining.find(&marker) {
        let value_start = start + marker.len();
        let after_marker = &remaining[value_start..];
        let Some(end) = after_marker.find('"') else {
            break;
        };
        values.push(decode_html(&after_marker[..end]));
        remaining = &after_marker[end + 1..];
    }
    values
}

fn extract_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let content = value.split_once(start)?.1;
    Some(content.split_once(end)?.0)
}

fn decode_html(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn build_lexical_queries(notes: &[CorpusNote]) -> HashMap<String, String> {
    let document_frequency = notes.iter().fold(HashMap::new(), |mut counts, note| {
        let terms = tokenize(&format!("{} {}", note.lexical_title, note.lexical_content))
            .into_iter()
            .collect::<HashSet<_>>();
        for term in terms {
            *counts.entry(term).or_insert(0_usize) += 1;
        }
        counts
    });
    let document_count = notes.len() as f64;

    notes
        .iter()
        .map(|note| {
            let mut term_frequency = HashMap::new();
            for term in tokenize(&note.lexical_content) {
                *term_frequency.entry(term).or_insert(0_usize) += 1;
            }
            // Termos do título ganham peso semântico, além do peso da coluna no
            // BM25, para terem maior chance de entrar no orçamento de 16 termos.
            for term in tokenize(&note.lexical_title) {
                *term_frequency.entry(term).or_insert(0_usize) += 4;
            }
            let mut weighted = term_frequency
                .into_iter()
                .map(|(term, frequency)| {
                    let df = *document_frequency.get(&term).unwrap_or(&1) as f64;
                    let idf = ((document_count + 1.0) / (df + 1.0)).ln() + 1.0;
                    let score = (1.0 + (frequency as f64).ln()) * idf;
                    (term, score)
                })
                .collect::<Vec<_>>();
            weighted.sort_by(|left, right| {
                right
                    .1
                    .total_cmp(&left.1)
                    .then_with(|| left.0.cmp(&right.0))
            });
            let query = weighted
                .into_iter()
                .take(QUERY_TERM_LIMIT)
                .map(|(term, _)| format!("\"{term}\"*"))
                .collect::<Vec<_>>()
                .join(" OR ");
            (note.id.clone(), query)
        })
        .collect()
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|term| term.chars().count() >= 3 && !is_stopword(term))
        .collect()
}

fn is_stopword(term: &str) -> bool {
    matches!(
        term,
        "a" | "ao"
            | "aos"
            | "as"
            | "com"
            | "como"
            | "da"
            | "das"
            | "de"
            | "do"
            | "dos"
            | "e"
            | "em"
            | "entre"
            | "essa"
            | "esse"
            | "esta"
            | "este"
            | "foi"
            | "mais"
            | "na"
            | "nas"
            | "no"
            | "nos"
            | "o"
            | "os"
            | "ou"
            | "para"
            | "pela"
            | "pelo"
            | "por"
            | "que"
            | "se"
            | "sem"
            | "ser"
            | "sua"
            | "suas"
            | "um"
            | "uma"
            | "the"
            | "and"
            | "for"
            | "from"
            | "into"
            | "with"
    )
}

fn reciprocal_rank_fusion(lexical: &[String], semantic: &[String], limit: usize) -> Vec<String> {
    let mut scores = HashMap::<String, f64>::new();
    for ranking in [lexical, semantic] {
        for (index, id) in ranking.iter().enumerate() {
            *scores.entry(id.clone()).or_default() += 1.0 / (RRF_K + index as f64 + 1.0);
        }
    }
    let mut fused = scores.into_iter().collect::<Vec<_>>();
    fused.sort_by(|left, right| {
        right
            .1
            .total_cmp(&left.1)
            .then_with(|| left.0.cmp(&right.0))
    });
    fused.into_iter().take(limit).map(|(id, _)| id).collect()
}

fn evaluate(
    strategy: &str,
    notes: &[CorpusNote],
    mut retrieve: impl FnMut(&str) -> Vec<String>,
) -> RetrievalMetrics {
    let mut hit_rate = 0.0;
    let mut precision = 0.0;
    let mut recall = 0.0;
    let mut reciprocal_rank = 0.0;
    let mut ndcg = 0.0;
    let mut latencies = Vec::new();
    let mut queries = 0;

    for note in notes.iter().filter(|note| !note.relevant.is_empty()) {
        let started = Instant::now();
        let ranking = retrieve(&note.id);
        latencies.push(started.elapsed());
        queries += 1;

        let hits_at_5 = ranking
            .iter()
            .take(SUGGESTION_LIMIT)
            .filter(|id| note.relevant.contains(id.as_str()))
            .count();
        let hits_at_20 = ranking
            .iter()
            .take(CANDIDATE_LIMIT)
            .filter(|id| note.relevant.contains(id.as_str()))
            .count();
        hit_rate += f64::from(hits_at_5 > 0);
        precision += hits_at_5 as f64 / SUGGESTION_LIMIT as f64;
        recall += hits_at_20 as f64 / note.relevant.len() as f64;
        reciprocal_rank += ranking
            .iter()
            .take(CANDIDATE_LIMIT)
            .position(|id| note.relevant.contains(id))
            .map_or(0.0, |index| 1.0 / (index as f64 + 1.0));
        ndcg += normalized_discounted_cumulative_gain(&ranking, &note.relevant, SUGGESTION_LIMIT);
    }

    assert!(queries > 0, "benchmark precisa de consultas julgadas");
    latencies.sort();
    let total_latency = latencies.iter().copied().sum::<Duration>();
    let p95_index = ((latencies.len() as f64 * 0.95).ceil() as usize)
        .saturating_sub(1)
        .min(latencies.len() - 1);
    let divisor = queries as f64;
    RetrievalMetrics {
        strategy: strategy.to_owned(),
        queries,
        hit_rate_at_5: hit_rate / divisor,
        precision_at_5: precision / divisor,
        recall_at_20: recall / divisor,
        mrr_at_20: reciprocal_rank / divisor,
        ndcg_at_5: ndcg / divisor,
        average_latency_ms: total_latency.as_secs_f64() * 1_000.0 / divisor,
        p95_latency_ms: latencies[p95_index].as_secs_f64() * 1_000.0,
    }
}

fn normalized_discounted_cumulative_gain(
    ranking: &[String],
    relevant: &HashSet<String>,
    limit: usize,
) -> f64 {
    let dcg = ranking
        .iter()
        .take(limit)
        .enumerate()
        .filter(|(_, id)| relevant.contains(id.as_str()))
        .map(|(index, _)| 1.0 / (index as f64 + 2.0).log2())
        .sum::<f64>();
    let ideal = (0..relevant.len().min(limit))
        .map(|index| 1.0 / (index as f64 + 2.0).log2())
        .sum::<f64>();
    if ideal == 0.0 {
        0.0
    } else {
        dcg / ideal
    }
}

fn model_loader() -> ModelLoader {
    ModelLoader::from_directory(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models/embeddinggemma-300m-q4"),
    )
    .expect("local model")
}

fn print_metrics(metrics: &[RetrievalMetrics]) {
    println!(
        "Estratégia | Queries | Hit@5 | Precision@5 | Recall@20 | MRR@20 | nDCG@5 | Latência média | p95"
    );
    println!("--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:");
    for row in metrics {
        println!(
            "{} | {} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} ms | {:.3} ms",
            row.strategy,
            row.queries,
            row.hit_rate_at_5,
            row.precision_at_5,
            row.recall_at_20,
            row.mrr_at_20,
            row.ndcg_at_5,
            row.average_latency_ms,
            row.p95_latency_ms
        );
    }
    println!(
        "HYPERZETTEL_RETRIEVAL_JSON={}",
        serde_json::to_string(metrics).expect("serialize retrieval metrics")
    );
}

#[test]
#[ignore = "release-only retrieval benchmark using the real local model"]
fn benchmark_lexical_semantic_and_hybrid_retrieval() {
    let (fixture, notes, edge_count) = load_corpus();

    let lexical_started = Instant::now();
    let lexical = LexicalIndex::build(&notes);
    let lexical_build = lexical_started.elapsed();

    let model_started = Instant::now();
    let mut model = model_loader().load().expect("load local model");
    let model_load = model_started.elapsed();
    let embedding_started = Instant::now();
    let semantic = SemanticIndex::build(&notes, &mut model);
    let embedding_build = embedding_started.elapsed();

    let lexical_metrics = evaluate("FTS5 lexical", &notes, |id| {
        lexical.rank(id, CANDIDATE_LIMIT)
    });
    let semantic_metrics = evaluate("EmbeddingGemma", &notes, |id| {
        semantic.rank(id, CANDIDATE_LIMIT)
    });
    let semantic_threshold_metrics = evaluate("EmbeddingGemma ≥0,68", &notes, |id| {
        semantic.rank_with_minimum(id, CANDIDATE_LIMIT, RELATION_CONFIG.minimum_similarity)
    });
    let hybrid_metrics = evaluate("RRF híbrido", &notes, |id| {
        reciprocal_rank_fusion(
            &lexical.rank(id, CANDIDATE_LIMIT),
            &semantic.rank(id, CANDIDATE_LIMIT),
            CANDIDATE_LIMIT,
        )
    });
    let hybrid_threshold_metrics = evaluate("RRF híbrido + limiar", &notes, |id| {
        reciprocal_rank_fusion(
            &lexical.rank(id, CANDIDATE_LIMIT),
            &semantic.rank_with_minimum(id, CANDIDATE_LIMIT, RELATION_CONFIG.minimum_similarity),
            CANDIDATE_LIMIT,
        )
    });

    println!(
        "Corpus: {} | {} notas | {} arestas manuais únicas",
        fixture.display(),
        notes.len(),
        edge_count
    );
    println!(
        "Preparação: FTS5 {:.1} ms | modelo {:.1} ms | embeddings {:.1} ms",
        lexical_build.as_secs_f64() * 1_000.0,
        model_load.as_secs_f64() * 1_000.0,
        embedding_build.as_secs_f64() * 1_000.0
    );
    print_metrics(&[
        lexical_metrics,
        semantic_metrics,
        semantic_threshold_metrics,
        hybrid_metrics,
        hybrid_threshold_metrics,
    ]);
}

#[test]
fn reciprocal_rank_fusion_rewards_agreement() {
    let lexical = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
    let semantic = vec!["c".to_owned(), "b".to_owned(), "d".to_owned()];
    let fused = reciprocal_rank_fusion(&lexical, &semantic, 4);
    assert_eq!(fused[0], "c");
    assert_eq!(fused[1], "b");
    assert!(fused.contains(&"a".to_owned()));
    assert!(fused.contains(&"d".to_owned()));
}

#[test]
fn ranking_metrics_reward_relevant_items_near_the_top() {
    let relevant = HashSet::from(["a".to_owned(), "b".to_owned()]);
    let best = vec!["a".to_owned(), "b".to_owned(), "x".to_owned()];
    let worse = vec!["x".to_owned(), "a".to_owned(), "b".to_owned()];
    assert!(
        normalized_discounted_cumulative_gain(&best, &relevant, 3)
            > normalized_discounted_cumulative_gain(&worse, &relevant, 3)
    );
    assert_eq!(
        normalized_discounted_cumulative_gain(&best, &relevant, 2),
        1.0
    );
}

#[test]
fn reads_the_real_vault_html_contract() {
    let html = r#"<!doctype html>
<html>
  <head>
    <meta name="hz:id" content="note-a">
    <meta name="hz:connection" content="note-b|Motivo &amp; evidência">
    <title>Título &amp; contexto</title>
  </head>
  <body><article class="hz-prose"><p>Corpo</p></article></body>
</html>"#;

    assert_eq!(extract_meta_values(html, "id"), vec!["note-a"]);
    assert_eq!(
        extract_meta_values(html, "connection"),
        vec!["note-b|Motivo & evidência"]
    );
    assert_eq!(
        extract_between(html, "<title>", "</title>").map(decode_html),
        Some("Título & contexto".to_owned())
    );
}
