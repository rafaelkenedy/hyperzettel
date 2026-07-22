use std::sync::{Arc, RwLock};

use tauri::Emitter;
use thiserror::Error;

use crate::knowledge::{
    domain::{
        ordered_note_ids, relation_id, NoteRelation, RejectedRelation, RelationStatus,
        RELATION_CONFIG,
    },
    infrastructure::{
        EmbeddingQueue, EmbeddingRepository, EmbeddingService, IndexReason, IndexRequest,
        KnowledgeNote, NoteRepository, RelationRepository, RepositoryError, SimilarityError,
    },
};

use super::{
    get_related_notes, index_note, rebuild_index, remove_note_from_index, IndexNoteDependencies,
    IndexOutcome,
};

#[derive(Debug, Error)]
pub enum RelationServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Embedding(#[from] crate::knowledge::domain::EmbeddingError),
    #[error(transparent)]
    Similarity(#[from] SimilarityError),
    #[error("note was not found")]
    NoteNotFound,
    #[error("embedding service returned no result")]
    EmbeddingResultMissing,
    #[error("relation status lock is poisoned")]
    StatusLockPoisoned,
}

impl RelationServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Repository(_) => "DATABASE_ERROR",
            Self::Embedding(error) => match error {
                crate::knowledge::domain::EmbeddingError::ModelFilesMissing => {
                    "MODEL_FILES_MISSING"
                }
                crate::knowledge::domain::EmbeddingError::ModelIntegrityFailed => {
                    "MODEL_INTEGRITY_FAILED"
                }
                crate::knowledge::domain::EmbeddingError::ModelLoadFailed => "MODEL_LOAD_FAILED",
                crate::knowledge::domain::EmbeddingError::TokenizationFailed => {
                    "TOKENIZATION_FAILED"
                }
                crate::knowledge::domain::EmbeddingError::InferenceFailed => "INFERENCE_FAILED",
                crate::knowledge::domain::EmbeddingError::Cancelled => "CANCELLED",
                crate::knowledge::domain::EmbeddingError::OutdatedRevision => "OUTDATED_REVISION",
                _ => "INVALID_EMBEDDING",
            },
            Self::Similarity(_) => "SIMILARITY_ERROR",
            Self::NoteNotFound => "NOTE_NOT_FOUND",
            Self::EmbeddingResultMissing => "INFERENCE_FAILED",
            Self::StatusLockPoisoned => "INTERNAL_STATE_ERROR",
        }
    }

    pub fn safe_message(&self) -> &'static str {
        match self.code() {
            "MODEL_FILES_MISSING" => "Os arquivos locais do modelo não foram encontrados.",
            "MODEL_INTEGRITY_FAILED" => "A validação dos arquivos locais do modelo falhou.",
            "MODEL_LOAD_FAILED" => "Não foi possível carregar o modelo local.",
            "TOKENIZATION_FAILED" | "INFERENCE_FAILED" | "INVALID_EMBEDDING" => {
                "Não foi possível analisar esta nota."
            }
            "NOTE_NOT_FOUND" | "OUTDATED_REVISION" | "CANCELLED" => {
                "A nota mudou antes da análise terminar."
            }
            _ => "Não foi possível atualizar as relações semânticas.",
        }
    }

    pub fn retryable(&self) -> bool {
        !matches!(
            self.code(),
            "MODEL_INTEGRITY_FAILED" | "INVALID_EMBEDDING" | "INTERNAL_STATE_ERROR"
        )
    }
}

pub struct RelationApplicationService {
    pub embedding_service: Arc<EmbeddingService>,
    pub embedding_repository: Arc<dyn EmbeddingRepository>,
    pub relation_repository: Arc<dyn RelationRepository>,
    pub note_repository: Arc<dyn NoteRepository>,
    pub queue: Arc<EmbeddingQueue>,
    status: RwLock<RelationStatus>,
    app_handle: RwLock<Option<tauri::AppHandle>>,
}

impl RelationApplicationService {
    pub fn new(
        embedding_service: Arc<EmbeddingService>,
        embedding_repository: Arc<dyn EmbeddingRepository>,
        relation_repository: Arc<dyn RelationRepository>,
        note_repository: Arc<dyn NoteRepository>,
    ) -> Arc<Self> {
        Arc::new(Self {
            embedding_service,
            embedding_repository,
            relation_repository,
            note_repository,
            queue: Arc::new(EmbeddingQueue::new()),
            status: RwLock::new(RelationStatus::Idle),
            app_handle: RwLock::new(None),
        })
    }

    pub fn attach_app_handle(
        &self,
        app_handle: tauri::AppHandle,
    ) -> Result<(), RelationServiceError> {
        *self
            .app_handle
            .write()
            .map_err(|_| RelationServiceError::StatusLockPoisoned)? = Some(app_handle);
        Ok(())
    }

    pub fn start_queue(self: &Arc<Self>) {
        self.queue.start(Arc::downgrade(self));
    }

    pub async fn index(
        &self,
        note_id: &str,
        revision: &str,
    ) -> Result<IndexOutcome, RelationServiceError> {
        let was_unloaded = !self.embedding_service.is_loaded().await;
        if was_unloaded {
            self.set_status(RelationStatus::LoadingModel)?;
        }
        let dependencies = IndexNoteDependencies {
            embedding_service: Arc::clone(&self.embedding_service),
            embedding_repository: Arc::clone(&self.embedding_repository),
            relation_repository: Arc::clone(&self.relation_repository),
            note_repository: Arc::clone(&self.note_repository),
        };
        let outcome = index_note(note_id, revision, &dependencies).await?;
        if was_unloaded {
            self.emit("knowledge-relations://model-ready", &serde_json::json!({}));
        }
        self.emit(
            "knowledge-relations://note-indexed",
            &serde_json::json!({ "noteId": note_id }),
        );
        if let IndexOutcome::Indexed { relation_count, .. } = &outcome {
            self.emit(
                "knowledge-relations://relations-updated",
                &serde_json::json!({ "noteId": note_id, "relationCount": relation_count }),
            );
        }
        Ok(outcome)
    }

    pub fn related(&self, note_id: &str) -> Result<Vec<NoteRelation>, RelationServiceError> {
        Ok(get_related_notes(
            note_id,
            self.relation_repository.as_ref(),
        )?)
    }

    pub async fn enqueue(&self, note_id: String, revision: String, reason: IndexReason) -> bool {
        self.queue
            .enqueue(IndexRequest {
                note_id,
                revision,
                reason,
            })
            .await
    }

    pub async fn rebuild(&self) -> Result<usize, RelationServiceError> {
        rebuild_index(self.note_repository.as_ref(), self.queue.as_ref()).await
    }

    pub async fn pause(&self) -> Result<(), RelationServiceError> {
        self.queue.pause().await;
        let snapshot = self.queue.snapshot().await;
        self.relation_repository
            .put_checkpoint(&crate::knowledge::domain::IndexingCheckpoint {
                pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
                processed_count: snapshot.processed,
                total_count: snapshot.total,
                status: "paused".to_owned(),
                last_processed_note_id: None,
                updated_at: chrono::Utc::now().to_rfc3339(),
            })?;
        self.set_status(RelationStatus::Paused {
            processed: snapshot.processed,
            total: snapshot.total,
        })
    }

    pub async fn resume(&self) -> Result<(), RelationServiceError> {
        self.queue.resume().await;
        let snapshot = self.queue.snapshot().await;
        self.set_status(if snapshot.pending == 0 {
            RelationStatus::Ready { relation_count: 0 }
        } else {
            RelationStatus::Indexing {
                processed: snapshot.processed,
                total: snapshot.total,
                current_note_id: None,
            }
        })
    }

    pub fn sync_notes(
        &self,
        notes: &[KnowledgeNote],
        replace_missing: bool,
    ) -> Result<usize, RelationServiceError> {
        let synced = self.note_repository.upsert_many(notes)?;
        if replace_missing {
            let retained = notes.iter().map(|note| note.id.clone()).collect::<Vec<_>>();
            self.note_repository.delete_missing(&retained)?;
        }
        Ok(synced)
    }

    pub async fn remove(&self, note_id: &str) -> Result<(), RelationServiceError> {
        self.queue.cancel_note(note_id).await;
        remove_note_from_index(note_id, self.relation_repository.as_ref())?;
        self.emit(
            "knowledge-relations://relations-updated",
            &serde_json::json!({ "noteId": note_id }),
        );
        Ok(())
    }

    pub fn reject(
        &self,
        first_note_id: &str,
        second_note_id: &str,
    ) -> Result<(), RelationServiceError> {
        let first_embedding = self
            .embedding_repository
            .get(first_note_id)?
            .ok_or(RelationServiceError::NoteNotFound)?;
        let second_embedding = self
            .embedding_repository
            .get(second_note_id)?
            .ok_or(RelationServiceError::NoteNotFound)?;
        let (ordered_first, ordered_second) = ordered_note_ids(first_note_id, second_note_id);
        let (first_hash, second_hash) = if ordered_first == first_note_id {
            (first_embedding.content_hash, second_embedding.content_hash)
        } else {
            (second_embedding.content_hash, first_embedding.content_hash)
        };
        let id = relation_id(ordered_first, ordered_second);
        self.relation_repository.put_rejected(&RejectedRelation {
            id: id.clone(),
            first_note_id: ordered_first.to_owned(),
            second_note_id: ordered_second.to_owned(),
            first_content_hash: first_hash,
            second_content_hash: second_hash,
            pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
            rejected_at: chrono::Utc::now().to_rfc3339(),
        })?;
        self.relation_repository.delete_relation(&id)?;
        self.emit(
            "knowledge-relations://relations-updated",
            &serde_json::json!({ "noteId": first_note_id }),
        );
        Ok(())
    }

    pub async fn restore(
        &self,
        first_note_id: &str,
        second_note_id: &str,
    ) -> Result<(), RelationServiceError> {
        let id = relation_id(first_note_id, second_note_id);
        self.relation_repository.delete_rejected(&id)?;

        // Removing one cache entry forces a fresh similarity pass. Restoring
        // only the rejection row would otherwise hit the unchanged shortcut.
        self.embedding_repository.delete(first_note_id)?;
        let note = self
            .note_repository
            .get(first_note_id)?
            .ok_or(RelationServiceError::NoteNotFound)?;
        self.enqueue(note.id, note.revision, IndexReason::Restored)
            .await;
        Ok(())
    }

    pub fn status(&self) -> Result<RelationStatus, RelationServiceError> {
        self.status
            .read()
            .map(|status| status.clone())
            .map_err(|_| RelationServiceError::StatusLockPoisoned)
    }

    pub fn set_status(&self, status: RelationStatus) -> Result<(), RelationServiceError> {
        *self
            .status
            .write()
            .map_err(|_| RelationServiceError::StatusLockPoisoned)? = status.clone();
        let event = match status {
            RelationStatus::LoadingModel => "knowledge-relations://model-loading",
            RelationStatus::Indexing { .. } => "knowledge-relations://indexing-progress",
            RelationStatus::Paused { .. } => "knowledge-relations://indexing-paused",
            RelationStatus::Ready { .. } => "knowledge-relations://indexing-completed",
            RelationStatus::Error { .. } => "knowledge-relations://error",
            RelationStatus::Idle => return Ok(()),
        };
        self.emit(event, &status);
        Ok(())
    }

    fn emit<S: serde::Serialize + Clone>(&self, event: &str, payload: &S) {
        if let Ok(handle) = self.app_handle.read() {
            if let Some(handle) = handle.as_ref() {
                let _ = handle.emit(event, payload.clone());
            }
        }
    }
}
