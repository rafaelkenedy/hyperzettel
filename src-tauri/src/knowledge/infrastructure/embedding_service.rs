use std::sync::Arc;

use fastembed::TextEmbedding;
use tokio::sync::Mutex;

use crate::knowledge::domain::{
    truncate_and_normalize, EmbeddingError, EmbeddingResult, RELATION_CONFIG,
};

use super::{ModelLoadError, ModelLoader};

#[derive(Clone)]
pub struct EmbeddingService {
    model: Arc<Mutex<Option<TextEmbedding>>>,
    model_loader: ModelLoader,
}

impl EmbeddingService {
    pub fn new(model_loader: ModelLoader) -> Self {
        Self {
            model: Arc::new(Mutex::new(None)),
            model_loader,
        }
    }

    pub async fn ensure_loaded(&self) -> Result<(), EmbeddingError> {
        if self.model.lock().await.is_some() {
            return Ok(());
        }
        let model = Arc::clone(&self.model);
        let loader = self.model_loader.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = model.blocking_lock();
            if guard.is_none() {
                *guard = Some(loader.load().map_err(map_model_load_error)?);
            }
            Ok(())
        })
        .await
        .map_err(|_| EmbeddingError::ModelLoadFailed)?
    }

    pub async fn embed_notes(
        &self,
        texts: &[String],
    ) -> Result<Vec<EmbeddingResult>, EmbeddingError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        self.ensure_loaded().await?;

        let texts = texts.to_vec();
        let model = Arc::clone(&self.model);
        tokio::task::spawn_blocking(move || {
            let mut counting_tokenizer = {
                let guard = model.blocking_lock();
                guard
                    .as_ref()
                    .ok_or(EmbeddingError::ModelLoadFailed)?
                    .tokenizer
                    .clone()
            };
            counting_tokenizer
                .with_truncation(None)
                .map_err(|_| EmbeddingError::TokenizationFailed)?;
            let input_tokens = texts
                .iter()
                .map(|text| {
                    counting_tokenizer
                        .encode(text.as_str(), true)
                        .map(|encoding| encoding.len())
                        .map_err(|_| EmbeddingError::TokenizationFailed)
                })
                .collect::<Result<Vec<_>, _>>()?;

            let embeddings = {
                let mut guard = model.blocking_lock();
                guard
                    .as_mut()
                    .ok_or(EmbeddingError::ModelLoadFailed)?
                    .embed(&texts, Some(RELATION_CONFIG.indexing_batch_size))
                    .map_err(|_| EmbeddingError::InferenceFailed)?
            };
            if embeddings.len() != texts.len() {
                return Err(EmbeddingError::InferenceFailed);
            }

            embeddings
                .into_iter()
                .zip(input_tokens)
                .map(|(embedding, input_tokens)| {
                    let source_dimensions = embedding.len();
                    Ok(EmbeddingResult {
                        vector: truncate_and_normalize(
                            &embedding,
                            RELATION_CONFIG.persisted_dimensions,
                        )?,
                        source_dimensions,
                        persisted_dimensions: RELATION_CONFIG.persisted_dimensions,
                        truncated: input_tokens > RELATION_CONFIG.maximum_input_tokens,
                        input_tokens,
                    })
                })
                .collect()
        })
        .await
        .map_err(|_| EmbeddingError::InferenceFailed)?
    }

    pub async fn is_loaded(&self) -> bool {
        self.model.lock().await.is_some()
    }
}

fn map_model_load_error(error: ModelLoadError) -> EmbeddingError {
    match error {
        ModelLoadError::ModelFilesMissing | ModelLoadError::ResourceDirectory => {
            EmbeddingError::ModelFilesMissing
        }
        ModelLoadError::ModelIntegrityFailed | ModelLoadError::UnsafeResourcePath => {
            EmbeddingError::ModelIntegrityFailed
        }
        ModelLoadError::ModelLoadFailed => EmbeddingError::ModelLoadFailed,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::{
        database::Database,
        knowledge::{
            application::{
                get_related_notes, index_note, remove_note_from_index, IndexNoteDependencies,
                IndexOutcome,
            },
            infrastructure::{
                dot_product, EmbeddingRepository, KnowledgeNote, NoteRepository,
                RelationRepository, SqliteEmbeddingRepository, SqliteNoteRepository,
                SqliteRelationRepository,
            },
        },
    };

    fn note(id: &str, revision: &str, content: &str) -> KnowledgeNote {
        KnowledgeNote {
            id: id.to_owned(),
            title: format!("Nota {id}"),
            content: content.to_owned(),
            tags: Vec::new(),
            revision: revision.to_owned(),
            folder: "resources".to_owned(),
            is_archived: false,
            is_deleted: false,
            updated_at: revision.to_owned(),
        }
    }

    fn local_model_loader() -> ModelLoader {
        ModelLoader::from_directory(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/models/embeddinggemma-300m-q4"),
        )
        .expect("model loader")
    }

    #[tokio::test]
    #[ignore = "loads the real 200 MB EmbeddingGemma model"]
    async fn model_is_lazy_singleton_and_returns_normalized_256d_vectors() {
        let loader = local_model_loader();
        let service = EmbeddingService::new(loader);
        assert!(!service.is_loaded().await);
        let results = service
            .embed_notes(&["task: sentence similarity | query:\n\nTítulo: teste".to_owned()])
            .await
            .expect("embedding");
        assert!(service.is_loaded().await);
        assert_eq!(results[0].source_dimensions, 768);
        assert_eq!(results[0].vector.len(), 256);
        let norm = results[0]
            .vector
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            .sqrt();
        assert!((norm - 1.0).abs() < 0.001);
    }

    #[tokio::test]
    #[ignore = "loads the real model and exercises SQLite end to end"]
    async fn real_pipeline_reuses_cache_and_updates_incrementally() {
        let database_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("integration-{}.sqlite", uuid::Uuid::new_v4()));
        let database = Database::open(&database_path).expect("database");
        let embeddings = Arc::new(SqliteEmbeddingRepository::new(database.clone()));
        let relations = Arc::new(SqliteRelationRepository::new(database.clone()));
        let notes = Arc::new(SqliteNoteRepository::new(database));
        let fixtures = [
            note(
                "A",
                "2026-01-01T00:00:00Z",
                "StateFlow mantém o estado mais recente e o entrega a novos coletores.",
            ),
            note(
                "B",
                "2026-01-01T00:00:00Z",
                "SharedFlow pode transmitir eventos para vários coletores sem representar estado.",
            ),
            note(
                "C",
                "2026-01-01T00:00:00Z",
                "Uma receita de pão utiliza farinha, fermento, água e sal.",
            ),
            note(
                "D",
                "2026-01-01T00:00:00Z",
                "StateFlow stores and exposes the latest state to new collectors.",
            ),
        ];
        notes.upsert_many(&fixtures).expect("seed notes");
        let embedding_service = Arc::new(EmbeddingService::new(local_model_loader()));
        let dependencies = IndexNoteDependencies {
            embedding_service,
            embedding_repository: embeddings.clone(),
            relation_repository: relations.clone(),
            note_repository: notes.clone(),
        };
        for fixture in &fixtures {
            index_note(&fixture.id, &fixture.revision, &dependencies)
                .await
                .expect("index fixture");
        }

        let a = embeddings.get("A").expect("read A").expect("A embedding");
        let c = embeddings.get("C").expect("read C").expect("C embedding");
        let d = embeddings.get("D").expect("read D").expect("D embedding");
        assert_eq!(a.dimensions, RELATION_CONFIG.persisted_dimensions);
        assert!(
            (a.vector
                .iter()
                .map(|value| value * value)
                .sum::<f32>()
                .sqrt()
                - 1.0)
                .abs()
                < 0.001
        );
        assert!(
            dot_product(&a.vector, &d.vector).expect("A/D score")
                > dot_product(&a.vector, &c.vector).expect("A/C score")
        );
        let related_to_a = relations.get_for_note("A").expect("relations for A");
        assert!(related_to_a
            .iter()
            .any(|item| item.first_note_id == "A" && item.second_note_id == "B"));
        assert!(related_to_a
            .iter()
            .any(|item| item.first_note_id == "A" && item.second_note_id == "D"));

        drop(dependencies);
        let reopened_database = Database::open(&database_path).expect("reopen database");
        let reopened_embeddings =
            Arc::new(SqliteEmbeddingRepository::new(reopened_database.clone()));
        let reopened_relations = Arc::new(SqliteRelationRepository::new(reopened_database.clone()));
        let reopened_notes = Arc::new(SqliteNoteRepository::new(reopened_database));
        let reopened_embedding_service = Arc::new(EmbeddingService::new(local_model_loader()));
        let reopened_dependencies = IndexNoteDependencies {
            embedding_service: reopened_embedding_service.clone(),
            embedding_repository: reopened_embeddings.clone(),
            relation_repository: reopened_relations.clone(),
            note_repository: reopened_notes.clone(),
        };
        assert!(matches!(
            index_note("A", "2026-01-01T00:00:00Z", &reopened_dependencies)
                .await
                .expect("cached A"),
            IndexOutcome::Unchanged { .. }
        ));
        assert!(!reopened_embedding_service.is_loaded().await);
        let _ = get_related_notes("A", reopened_relations.as_ref()).expect("read relations");
        assert!(!reopened_embedding_service.is_loaded().await);

        let unchanged_a = reopened_embeddings
            .get("A")
            .expect("A before edit")
            .expect("A");
        let changed_b = note(
            "B",
            "2026-01-02T00:00:00Z",
            "SharedFlow transmite eventos para muitos coletores Kotlin sem armazenar estado.",
        );
        reopened_notes
            .upsert_many(std::slice::from_ref(&changed_b))
            .expect("edit B");
        index_note("B", &changed_b.revision, &reopened_dependencies)
            .await
            .expect("reindex B");
        assert_eq!(
            reopened_embeddings
                .get("A")
                .expect("A after edit")
                .expect("A"),
            unchanged_a
        );
        assert_eq!(
            reopened_embeddings
                .get("B")
                .expect("B after edit")
                .expect("B")
                .source_revision,
            changed_b.revision
        );

        remove_note_from_index("B", reopened_relations.as_ref()).expect("remove B");
        assert!(reopened_embeddings
            .get("B")
            .expect("removed embedding")
            .is_none());
        assert!(reopened_relations
            .get_for_note("A")
            .expect("relations after removal")
            .iter()
            .all(|item| item.first_note_id != "B" && item.second_note_id != "B"));
    }
}
