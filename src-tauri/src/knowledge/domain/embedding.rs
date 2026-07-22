use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::RELATION_CONFIG;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum EmbeddingError {
    #[error("model files are missing")]
    ModelFilesMissing,
    #[error("model file integrity validation failed")]
    ModelIntegrityFailed,
    #[error("failed to load embedding model")]
    ModelLoadFailed,
    #[error("failed to tokenize note")]
    TokenizationFailed,
    #[error("embedding inference failed")]
    InferenceFailed,
    #[error(
        "embedding dimensions are invalid: expected at least {expected_at_least}, got {actual}"
    )]
    InvalidDimensions {
        expected_at_least: usize,
        actual: usize,
    },
    #[error("embedding norm is invalid")]
    InvalidNorm,
    #[error("embedding contains a non-finite value")]
    NonFiniteValue,
    #[error("embedding blob length is invalid")]
    InvalidBlobLength,
    #[error("embedding task was cancelled")]
    Cancelled,
    #[error("embedding belongs to an outdated note revision")]
    OutdatedRevision,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddingResult {
    pub vector: Vec<f32>,
    pub source_dimensions: usize,
    pub persisted_dimensions: usize,
    pub truncated: bool,
    pub input_tokens: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEmbedding {
    pub note_id: String,
    #[serde(skip)]
    pub vector: Vec<f32>,
    pub dimensions: usize,
    pub content_hash: String,
    pub model_id: String,
    pub model_variant: String,
    pub pipeline_version: String,
    pub source_revision: String,
    pub truncated: bool,
    pub input_tokens: Option<usize>,
    pub created_at: String,
    pub updated_at: String,
}

impl NoteEmbedding {
    pub fn is_current(&self) -> bool {
        self.model_id == RELATION_CONFIG.model_id
            && self.model_variant == RELATION_CONFIG.model_variant
            && self.pipeline_version == RELATION_CONFIG.pipeline_version
            && self.dimensions == RELATION_CONFIG.persisted_dimensions
    }
}

pub fn truncate_and_normalize(
    source: &[f32],
    dimensions: usize,
) -> Result<Vec<f32>, EmbeddingError> {
    if source.len() < dimensions {
        return Err(EmbeddingError::InvalidDimensions {
            expected_at_least: dimensions,
            actual: source.len(),
        });
    }

    let mut result = source[..dimensions].to_vec();
    if result.iter().any(|value| !value.is_finite()) {
        return Err(EmbeddingError::NonFiniteValue);
    }

    let norm_squared = result.iter().map(|value| value * value).sum::<f32>();
    if !norm_squared.is_finite() || norm_squared <= f32::EPSILON {
        return Err(EmbeddingError::InvalidNorm);
    }

    let norm = norm_squared.sqrt();
    for value in &mut result {
        *value /= norm;
        if !value.is_finite() {
            return Err(EmbeddingError::NonFiniteValue);
        }
    }
    Ok(result)
}

pub fn embedding_to_blob(vector: &[f32]) -> Result<Vec<u8>, EmbeddingError> {
    if vector.iter().any(|value| !value.is_finite()) {
        return Err(EmbeddingError::NonFiniteValue);
    }
    let mut blob = Vec::with_capacity(std::mem::size_of_val(vector));
    for value in vector {
        blob.extend_from_slice(&value.to_le_bytes());
    }
    Ok(blob)
}

pub fn embedding_from_blob(
    blob: &[u8],
    registered_dimensions: usize,
    expected_dimensions: usize,
) -> Result<Vec<f32>, EmbeddingError> {
    if blob.len() % std::mem::size_of::<f32>() != 0 {
        return Err(EmbeddingError::InvalidBlobLength);
    }
    let actual_dimensions = blob.len() / std::mem::size_of::<f32>();
    if registered_dimensions != expected_dimensions || actual_dimensions != registered_dimensions {
        return Err(EmbeddingError::InvalidDimensions {
            expected_at_least: expected_dimensions,
            actual: actual_dimensions,
        });
    }

    let mut vector = Vec::with_capacity(actual_dimensions);
    for chunk in blob.chunks_exact(std::mem::size_of::<f32>()) {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if !value.is_finite() {
            return Err(EmbeddingError::NonFiniteValue);
        }
        vector.push(value);
    }
    Ok(vector)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_to_256_and_normalizes_again() {
        let source = (1..=768).map(|value| value as f32).collect::<Vec<_>>();
        let result = truncate_and_normalize(&source, 256).expect("valid embedding");
        let norm = result.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert_eq!(result.len(), 256);
        assert!((norm - 1.0).abs() < 0.000_1);
    }

    #[test]
    fn rejects_short_zero_and_non_finite_vectors() {
        assert!(matches!(
            truncate_and_normalize(&[1.0; 4], 5),
            Err(EmbeddingError::InvalidDimensions { .. })
        ));
        assert_eq!(
            truncate_and_normalize(&[0.0; 4], 4),
            Err(EmbeddingError::InvalidNorm)
        );
        assert_eq!(
            truncate_and_normalize(&[1.0, f32::NAN], 2),
            Err(EmbeddingError::NonFiniteValue)
        );
        assert_eq!(
            truncate_and_normalize(&[1.0, f32::INFINITY], 2),
            Err(EmbeddingError::NonFiniteValue)
        );
    }

    #[test]
    fn blob_round_trip_preserves_little_endian_f32_values() {
        let vector = vec![0.25, -0.5, 1.0];
        let blob = embedding_to_blob(&vector).expect("serializable vector");
        assert_eq!(&blob[..4], &0.25_f32.to_le_bytes());
        assert_eq!(
            embedding_from_blob(&blob, vector.len(), vector.len()).expect("valid blob"),
            vector
        );
    }

    #[test]
    fn blob_validation_rejects_bad_length_dimension_and_nan() {
        assert_eq!(
            embedding_from_blob(&[0, 1, 2], 1, 1),
            Err(EmbeddingError::InvalidBlobLength)
        );
        assert!(matches!(
            embedding_from_blob(&[0; 8], 2, 3),
            Err(EmbeddingError::InvalidDimensions { .. })
        ));
        assert_eq!(
            embedding_from_blob(&f32::NAN.to_le_bytes(), 1, 1),
            Err(EmbeddingError::NonFiniteValue)
        );
    }
}
