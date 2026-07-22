use std::{collections::HashMap, sync::Arc};

use chrono::Utc;

use crate::knowledge::{
    domain::{
        ordered_note_ids, relation_id, NoteEmbedding, NoteRelation, RelationKind, RelationOrigin,
        RELATION_CONFIG,
    },
    infrastructure::{
        find_nearest, prepare_note_text, EmbeddingRepository, EmbeddingService, NoteRepository,
        RelationRepository, SimilarityCandidate,
    },
};

use super::RelationServiceError;

pub struct IndexNoteDependencies {
    pub embedding_service: Arc<EmbeddingService>,
    pub embedding_repository: Arc<dyn EmbeddingRepository>,
    pub relation_repository: Arc<dyn RelationRepository>,
    pub note_repository: Arc<dyn NoteRepository>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IndexOutcome {
    Unchanged {
        truncated: bool,
    },
    Indexed {
        relation_count: usize,
        truncated: bool,
        input_tokens: usize,
    },
    OutdatedRevision,
}

pub async fn index_note(
    note_id: &str,
    expected_revision: &str,
    dependencies: &IndexNoteDependencies,
) -> Result<IndexOutcome, RelationServiceError> {
    let note = dependencies
        .note_repository
        .get(note_id)?
        .ok_or(RelationServiceError::NoteNotFound)?;
    if note.revision != expected_revision {
        return Ok(IndexOutcome::OutdatedRevision);
    }

    let prepared = prepare_note_text(&note.title, &note.content, &note.tags);
    let existing = dependencies.embedding_repository.get(note_id)?;
    if let Some(existing) = &existing {
        if existing.is_current() && existing.content_hash == prepared.content_hash {
            return Ok(IndexOutcome::Unchanged {
                truncated: existing.truncated,
            });
        }
    }

    let mut generated = dependencies
        .embedding_service
        .embed_notes(&[prepared.value])
        .await?;
    let generated = generated
        .pop()
        .ok_or(RelationServiceError::EmbeddingResultMissing)?;

    let current_note = dependencies
        .note_repository
        .get(note_id)?
        .ok_or(RelationServiceError::NoteNotFound)?;
    if current_note.revision != expected_revision {
        return Ok(IndexOutcome::OutdatedRevision);
    }

    let now = Utc::now().to_rfc3339();
    let source = NoteEmbedding {
        note_id: note.id.clone(),
        vector: generated.vector,
        dimensions: generated.persisted_dimensions,
        content_hash: prepared.content_hash,
        model_id: RELATION_CONFIG.model_id.to_owned(),
        model_variant: RELATION_CONFIG.model_variant.to_owned(),
        pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
        source_revision: note.revision.clone(),
        truncated: generated.truncated,
        input_tokens: Some(generated.input_tokens),
        created_at: existing
            .as_ref()
            .map_or_else(|| now.clone(), |item| item.created_at.clone()),
        updated_at: now.clone(),
    };

    let active_notes = dependencies.note_repository.get_all_active()?;
    let active_note_ids = active_notes
        .iter()
        .map(|candidate| candidate.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let candidates = dependencies
        .embedding_repository
        .get_all()?
        .into_iter()
        .filter(|candidate| active_note_ids.contains(candidate.note_id.as_str()))
        .filter(NoteEmbedding::is_current)
        .collect::<Vec<_>>();
    let matches = find_nearest(
        note_id,
        &source.vector,
        candidates.iter().map(|candidate| SimilarityCandidate {
            note_id: &candidate.note_id,
            vector: &candidate.vector,
            updated_at: &candidate.updated_at,
        }),
        RELATION_CONFIG.candidate_limit,
        RELATION_CONFIG.minimum_similarity,
    )?;

    let candidates_by_id = candidates
        .iter()
        .map(|candidate| (candidate.note_id.as_str(), candidate))
        .collect::<HashMap<_, _>>();
    let previous_relations = dependencies.relation_repository.get_for_note(note_id)?;
    let previous_by_id = previous_relations
        .iter()
        .map(|relation| (relation.id.as_str(), relation))
        .collect::<HashMap<_, _>>();
    let rejected = dependencies
        .relation_repository
        .get_rejected_for_note(note_id)?;
    let rejected_by_id = rejected
        .iter()
        .map(|relation| (relation.id.as_str(), relation))
        .collect::<HashMap<_, _>>();

    let mut relations = Vec::new();
    for matched in matches {
        if relations.len() >= RELATION_CONFIG.maximum_relations_per_note {
            break;
        }
        let Some(target) = candidates_by_id.get(matched.note_id.as_str()).copied() else {
            continue;
        };
        let id = relation_id(note_id, &target.note_id);
        if rejection_still_applies(rejected_by_id.get(id.as_str()).copied(), &source, target) {
            continue;
        }
        let (first_note_id, second_note_id) = ordered_note_ids(note_id, &target.note_id);
        let (first_revision, second_revision) = if first_note_id == note_id {
            (&source.source_revision, &target.source_revision)
        } else {
            (&target.source_revision, &source.source_revision)
        };
        relations.push(NoteRelation {
            id: id.clone(),
            first_note_id: first_note_id.to_owned(),
            second_note_id: second_note_id.to_owned(),
            score: matched.score,
            origin: RelationOrigin::Automatic,
            kind: RelationKind::Semantic,
            model_id: RELATION_CONFIG.model_id.to_owned(),
            pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
            first_revision: first_revision.clone(),
            second_revision: second_revision.clone(),
            created_at: previous_by_id
                .get(id.as_str())
                .map_or_else(|| now.clone(), |previous| previous.created_at.clone()),
            updated_at: now.clone(),
        });
    }

    // Relations are replaced before the cache marker is committed. If the
    // second write fails, the next request safely retries instead of treating
    // a partially persisted index operation as unchanged.
    dependencies
        .relation_repository
        .replace_automatic_for_note(note_id, &relations)?;
    dependencies.embedding_repository.put(&source)?;

    Ok(IndexOutcome::Indexed {
        relation_count: relations.len(),
        truncated: generated.truncated,
        input_tokens: generated.input_tokens,
    })
}

fn rejection_still_applies(
    rejected: Option<&crate::knowledge::domain::RejectedRelation>,
    source: &NoteEmbedding,
    target: &NoteEmbedding,
) -> bool {
    let Some(rejected) = rejected else {
        return false;
    };
    if rejected.pipeline_version != RELATION_CONFIG.pipeline_version {
        return false;
    }
    let (first_id, _) = ordered_note_ids(&source.note_id, &target.note_id);
    let (first_hash, second_hash) = if first_id == source.note_id {
        (&source.content_hash, &target.content_hash)
    } else {
        (&target.content_hash, &source.content_hash)
    };
    rejected.first_content_hash == *first_hash && rejected.second_content_hash == *second_hash
}
