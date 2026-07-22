mod embedding_queue;
mod embedding_repository;
mod embedding_service;
mod model_loader;
mod note_repository;
mod relation_repository;
mod repository_error;
mod similarity_search;
mod text_preparation;

pub use embedding_queue::{EmbeddingQueue, IndexReason, IndexRequest, QueueSnapshot};
pub use embedding_repository::{EmbeddingRepository, SqliteEmbeddingRepository};
pub use embedding_service::EmbeddingService;
pub use model_loader::{resolve_model_directory, ModelLoadError, ModelLoader};
pub use note_repository::{KnowledgeNote, NoteRepository, SqliteNoteRepository};
pub use relation_repository::{RelationRepository, SqliteRelationRepository};
pub use repository_error::RepositoryError;
pub use similarity_search::{
    dot_product, find_nearest, SimilarityCandidate, SimilarityError, SimilarityMatch,
};
pub use text_preparation::{normalize_semantic_text, prepare_note_text, PreparedNoteText};
