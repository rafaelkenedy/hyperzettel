use thiserror::Error;

use crate::{database::DatabaseError, knowledge::domain::EmbeddingError};

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error(transparent)]
    Embedding(#[from] EmbeddingError),
    #[error("stored knowledge data is invalid")]
    InvalidData,
    #[error("failed to serialize knowledge data")]
    Json(#[from] serde_json::Error),
}

impl From<std::num::TryFromIntError> for RepositoryError {
    fn from(_: std::num::TryFromIntError) -> Self {
        Self::InvalidData
    }
}
