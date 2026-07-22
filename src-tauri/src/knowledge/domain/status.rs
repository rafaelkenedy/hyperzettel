use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RelationStatus {
    Idle,
    LoadingModel,
    Indexing {
        processed: usize,
        total: usize,
        current_note_id: Option<String>,
    },
    Ready {
        relation_count: usize,
    },
    Paused {
        processed: usize,
        total: usize,
    },
    Error {
        code: String,
        message: String,
        retryable: bool,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationMetrics {
    pub model_load_duration_ms: u64,
    pub tokenization_duration_ms: u64,
    pub inference_duration_ms: u64,
    pub normalization_duration_ms: u64,
    pub similarity_search_duration_ms: u64,
    pub persistence_duration_ms: u64,
    pub batch_size: usize,
    pub input_tokens: usize,
    pub candidate_count: usize,
    pub relation_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexingCheckpoint {
    pub pipeline_version: String,
    pub processed_count: usize,
    pub total_count: usize,
    pub status: String,
    pub last_processed_note_id: Option<String>,
    pub updated_at: String,
}
