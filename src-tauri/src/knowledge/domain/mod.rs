mod config;
mod embedding;
mod relation;
mod status;

pub use config::{RelationConfig, RELATION_CONFIG};
pub use embedding::{
    embedding_from_blob, embedding_to_blob, truncate_and_normalize, EmbeddingError,
    EmbeddingResult, NoteEmbedding,
};
pub use relation::{
    ordered_note_ids, relation_id, NoteRelation, RejectedRelation, RelationKind, RelationOrigin,
};
pub use status::{IndexingCheckpoint, RelationMetrics, RelationStatus};
