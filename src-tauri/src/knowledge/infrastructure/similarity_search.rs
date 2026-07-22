use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SimilarityError {
    #[error("embedding dimensions do not match: {first} and {second}")]
    DimensionMismatch { first: usize, second: usize },
    #[error("similarity score is not finite")]
    NonFiniteScore,
}

#[derive(Debug, Clone)]
pub struct SimilarityCandidate<'a> {
    pub note_id: &'a str,
    pub vector: &'a [f32],
    pub updated_at: &'a str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimilarityMatch {
    pub note_id: String,
    pub score: f32,
    pub updated_at: String,
}

pub fn dot_product(first: &[f32], second: &[f32]) -> Result<f32, SimilarityError> {
    if first.len() != second.len() {
        return Err(SimilarityError::DimensionMismatch {
            first: first.len(),
            second: second.len(),
        });
    }
    let score = first
        .iter()
        .zip(second)
        .map(|(left, right)| left * right)
        .sum::<f32>();
    if !score.is_finite() {
        return Err(SimilarityError::NonFiniteScore);
    }
    Ok(score.clamp(-1.0, 1.0))
}

pub fn find_nearest<'a>(
    source_note_id: &str,
    source_vector: &[f32],
    candidates: impl IntoIterator<Item = SimilarityCandidate<'a>>,
    limit: usize,
    minimum_similarity: f32,
) -> Result<Vec<SimilarityMatch>, SimilarityError> {
    let mut matches = Vec::new();
    for candidate in candidates {
        if candidate.note_id == source_note_id {
            continue;
        }
        let score = dot_product(source_vector, candidate.vector)?;
        if score >= minimum_similarity {
            matches.push(SimilarityMatch {
                note_id: candidate.note_id.to_owned(),
                score,
                updated_at: candidate.updated_at.to_owned(),
            });
        }
    }
    matches.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.note_id.cmp(&right.note_id))
    });
    matches.truncate(limit);
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_product_handles_equal_orthogonal_and_mismatched_vectors() {
        assert!((dot_product(&[1.0, 0.0], &[1.0, 0.0]).expect("score") - 1.0).abs() < 0.000_1);
        assert!(dot_product(&[1.0, 0.0], &[0.0, 1.0]).expect("score").abs() < 0.000_1);
        assert_eq!(
            dot_product(&[1.0], &[1.0, 0.0]),
            Err(SimilarityError::DimensionMismatch {
                first: 1,
                second: 2
            })
        );
    }

    #[test]
    fn nearest_search_filters_orders_limits_and_ignores_source() {
        let own = [1.0, 0.0];
        let best = [0.9, 0.1];
        let second = [0.8, 0.2];
        let below = [0.1, 0.9];
        let matches = find_nearest(
            "source",
            &own,
            [
                SimilarityCandidate {
                    note_id: "source",
                    vector: &own,
                    updated_at: "3",
                },
                SimilarityCandidate {
                    note_id: "second",
                    vector: &second,
                    updated_at: "2",
                },
                SimilarityCandidate {
                    note_id: "best",
                    vector: &best,
                    updated_at: "1",
                },
                SimilarityCandidate {
                    note_id: "below",
                    vector: &below,
                    updated_at: "4",
                },
            ],
            2,
            0.5,
        )
        .expect("matches");
        assert_eq!(
            matches
                .iter()
                .map(|item| item.note_id.as_str())
                .collect::<Vec<_>>(),
            vec!["best", "second"]
        );
    }
}
