#![cfg_attr(target_os = "windows", allow(linker_messages))]

use std::{fs, path::PathBuf, process::Command, time::Instant};

use fastembed::TextEmbedding;
use hyperzettel_lib::knowledge::{
    domain::{embedding_to_blob, truncate_and_normalize, RELATION_CONFIG},
    infrastructure::{dot_product, prepare_note_text, ModelLoader},
};
use rusqlite::{params, Connection};
use serde::Deserialize;

#[derive(Deserialize)]
struct BenchmarkNote {
    title: String,
    content: String,
}

fn fixture_texts() -> Vec<String> {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/seed/cs50-notes.json");
    let source = fs::read_to_string(&fixture).unwrap_or_else(|error| {
        panic!(
            "benchmark fixture ausente em {}: {error}",
            fixture.display()
        )
    });
    let notes: Vec<BenchmarkNote> = serde_json::from_str(&source).expect("CS50 notes fixture");
    assert!(
        notes.len() >= 42,
        "benchmark requires the fixed 42-note subset"
    );
    notes
        .into_iter()
        .take(42)
        .map(|note| prepare_note_text(&note.title, &note.content, &[]).value)
        .collect()
}

fn model_loader() -> ModelLoader {
    ModelLoader::from_directory(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/models/embeddinggemma-300m-q4"),
    )
    .expect("local model")
}

fn working_set_mib() -> Option<f64> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    let command = format!("(Get-Process -Id {}).WorkingSet64", std::process::id());
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .output()
        .ok()?;
    let bytes = String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()?;
    Some(bytes as f64 / 1024.0 / 1024.0)
}

fn tokenize(model: &TextEmbedding, texts: &[String]) -> (usize, u128) {
    let started = Instant::now();
    let tokens = texts
        .iter()
        .map(|text| {
            model
                .tokenizer
                .encode(text.as_str(), true)
                .expect("tokenize")
                .len()
        })
        .sum();
    (tokens, started.elapsed().as_millis())
}

fn persistence_duration(vectors: &[Vec<f32>]) -> u128 {
    let mut connection = Connection::open_in_memory().expect("benchmark database");
    connection
        .execute(
            "CREATE TABLE vectors (id INTEGER PRIMARY KEY, vector BLOB NOT NULL)",
            [],
        )
        .expect("benchmark table");
    let started = Instant::now();
    let transaction = connection.transaction().expect("benchmark transaction");
    for (index, vector) in vectors.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO vectors (id, vector) VALUES (?1, ?2)",
                params![index, embedding_to_blob(vector).expect("embedding blob")],
            )
            .expect("persist vector");
    }
    transaction.commit().expect("commit vectors");
    started.elapsed().as_millis()
}

#[test]
#[ignore = "release-only benchmark using the real local model"]
fn benchmark_embeddinggemma() {
    const CHILD_BATCH: &str = "HYPERZETTEL_BENCHMARK_BATCH";
    if let Ok(value) = std::env::var(CHILD_BATCH) {
        run_batch(value.parse().expect("batch size"));
        return;
    }

    println!("Runtime | Batch | Model load | 42 notas | Nota média | RAM | Tokens | Notas/s | Tokenização | Normalização | Persistência | Busca");
    println!("--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:");
    for batch_size in [1, 2, 4, 8] {
        let output = Command::new(std::env::current_exe().expect("benchmark executable"))
            .args([
                "benchmark_embeddinggemma",
                "--exact",
                "--ignored",
                "--nocapture",
            ])
            .env(CHILD_BATCH, batch_size.to_string())
            .output()
            .expect("isolated benchmark process");
        assert!(
            output.status.success(),
            "batch {batch_size} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if line.starts_with("Rust |") {
                println!("{line}");
            }
        }
    }
}

fn run_batch(batch_size: usize) {
    let texts = fixture_texts();
    let total_started = Instant::now();
    let load_started = Instant::now();
    let mut model = model_loader().load().expect("load local model");
    let model_load_ms = load_started.elapsed().as_millis();
    let (token_count, tokenization_ms) = tokenize(&model, &texts);

    let inference_started = Instant::now();
    let source_vectors = model
        .embed(&texts, Some(batch_size))
        .expect("embed fixture");
    let inference_ms = inference_started.elapsed().as_millis();

    let normalization_started = Instant::now();
    let vectors = source_vectors
        .iter()
        .map(|vector| {
            truncate_and_normalize(vector, RELATION_CONFIG.persisted_dimensions)
                .expect("normalize vector")
        })
        .collect::<Vec<_>>();
    let normalization_ms = normalization_started.elapsed().as_millis();
    assert!(vectors.iter().all(|vector| vector.len() == 256));
    assert!(vectors.iter().all(|vector| {
        (vector.iter().map(|value| value * value).sum::<f32>().sqrt() - 1.0).abs() <= 0.001
    }));

    let persistence_ms = persistence_duration(&vectors);
    let search_started = Instant::now();
    for source in &vectors {
        let mut scores = vectors
            .iter()
            .map(|target| dot_product(source, target).expect("dot product"))
            .collect::<Vec<_>>();
        scores.sort_by(|left, right| right.total_cmp(left));
        scores.truncate(RELATION_CONFIG.candidate_limit);
    }
    let search_ms = search_started.elapsed().as_millis();
    let total_ms = total_started.elapsed().as_millis();
    let average_ms = inference_ms as f64 / texts.len() as f64;
    let notes_per_second = texts.len() as f64 / (inference_ms as f64 / 1000.0);
    let ram = working_set_mib()
        .map(|value| format!("{value:.0} MiB"))
        .unwrap_or_else(|| "n/d".to_owned());
    println!(
        "Rust | {batch_size} | {model_load_ms} ms | {total_ms} ms | {average_ms:.1} ms | {ram} | {token_count} | {notes_per_second:.2} | {tokenization_ms} ms | {normalization_ms} ms | {persistence_ms} ms | {search_ms} ms"
    );
}
