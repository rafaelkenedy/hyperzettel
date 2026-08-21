use serde::{Deserialize, Serialize};

use crate::{
    knowledge::{
        application::RelationServiceError,
        domain::{relation_id, NoteRelation, RejectedRelation, RelationStatus},
        infrastructure::{IndexReason, KnowledgeNote, RepositoryError},
    },
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl From<RelationServiceError> for RelationCommandError {
    fn from(error: RelationServiceError) -> Self {
        Self {
            code: error.code().to_owned(),
            message: error.safe_message().to_owned(),
            retryable: error.retryable(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueIndexingResponse {
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResponse {
    pub accepted_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncNotesResponse {
    pub synced_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRejectedResponse {
    pub imported_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedRelationBackup {
    pub first_note_id: String,
    pub second_note_id: String,
    pub first_content_hash: String,
    pub second_content_hash: String,
    pub pipeline_version: String,
    pub rejected_at: String,
}

impl From<RejectedRelation> for RejectedRelationBackup {
    fn from(rejected: RejectedRelation) -> Self {
        Self {
            first_note_id: rejected.first_note_id,
            second_note_id: rejected.second_note_id,
            first_content_hash: rejected.first_content_hash,
            second_content_hash: rejected.second_content_hash,
            pipeline_version: rejected.pipeline_version,
            rejected_at: rejected.rejected_at,
        }
    }
}

impl From<RejectedRelationBackup> for RejectedRelation {
    fn from(rejected: RejectedRelationBackup) -> Self {
        Self {
            id: relation_id(&rejected.first_note_id, &rejected.second_note_id),
            first_note_id: rejected.first_note_id,
            second_note_id: rejected.second_note_id,
            first_content_hash: rejected.first_content_hash,
            second_content_hash: rejected.second_content_hash,
            pipeline_version: rejected.pipeline_version,
            rejected_at: rejected.rejected_at,
        }
    }
}

const MAX_BACKUP_REJECTIONS: usize = 100_000;

#[tauri::command]
pub async fn sync_knowledge_notes(
    state: tauri::State<'_, AppState>,
    notes: Vec<KnowledgeNote>,
    replace_missing: bool,
) -> Result<SyncNotesResponse, RelationCommandError> {
    let synced_count = state.relation_service.sync_notes(&notes, replace_missing)?;
    Ok(SyncNotesResponse { synced_count })
}

#[tauri::command]
pub async fn enqueue_note_indexing(
    state: tauri::State<'_, AppState>,
    note_id: String,
    revision: String,
) -> Result<EnqueueIndexingResponse, RelationCommandError> {
    let accepted = state
        .relation_service
        .enqueue(note_id, revision, IndexReason::Updated)
        .await;
    Ok(EnqueueIndexingResponse { accepted })
}

#[tauri::command]
pub async fn get_related_notes(
    state: tauri::State<'_, AppState>,
    note_id: String,
) -> Result<Vec<NoteRelation>, RelationCommandError> {
    Ok(state.relation_service.related(&note_id)?)
}

#[tauri::command]
pub async fn get_relation_status(
    state: tauri::State<'_, AppState>,
) -> Result<RelationStatus, RelationCommandError> {
    Ok(state.relation_service.status()?)
}

#[tauri::command]
pub async fn rebuild_knowledge_relations(
    state: tauri::State<'_, AppState>,
) -> Result<RebuildResponse, RelationCommandError> {
    let accepted_count = state.relation_service.rebuild().await?;
    Ok(RebuildResponse { accepted_count })
}

#[tauri::command]
pub async fn pause_relation_indexing(
    state: tauri::State<'_, AppState>,
) -> Result<(), RelationCommandError> {
    state.relation_service.pause().await?;
    Ok(())
}

#[tauri::command]
pub async fn resume_relation_indexing(
    state: tauri::State<'_, AppState>,
) -> Result<(), RelationCommandError> {
    state.relation_service.resume().await?;
    Ok(())
}

#[tauri::command]
pub async fn reject_automatic_relation(
    state: tauri::State<'_, AppState>,
    first_note_id: String,
    second_note_id: String,
) -> Result<(), RelationCommandError> {
    state
        .relation_service
        .reject(&first_note_id, &second_note_id)?;
    Ok(())
}

#[tauri::command]
pub async fn restore_automatic_relation(
    state: tauri::State<'_, AppState>,
    first_note_id: String,
    second_note_id: String,
) -> Result<(), RelationCommandError> {
    state
        .relation_service
        .restore(&first_note_id, &second_note_id)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn export_rejected_relations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RejectedRelationBackup>, RelationCommandError> {
    Ok(state
        .relation_service
        .export_rejected()?
        .into_iter()
        .map(RejectedRelationBackup::from)
        .collect())
}

#[tauri::command]
pub async fn import_rejected_relations(
    state: tauri::State<'_, AppState>,
    rejected_relations: Vec<RejectedRelationBackup>,
) -> Result<ImportRejectedResponse, RelationCommandError> {
    if rejected_relations.len() > MAX_BACKUP_REJECTIONS {
        return Err(RelationCommandError {
            code: "INVALID_BACKUP_DATA".to_owned(),
            message: "O backup contém decisões semânticas demais.".to_owned(),
            retryable: false,
        });
    }
    let rejected_relations = rejected_relations
        .into_iter()
        .map(RejectedRelation::from)
        .collect::<Vec<_>>();
    let imported_count = match state.relation_service.import_rejected(&rejected_relations) {
        Ok(count) => count,
        Err(RelationServiceError::Repository(RepositoryError::InvalidData)) => {
            return Err(RelationCommandError {
                code: "INVALID_BACKUP_DATA".to_owned(),
                message: "O backup contém decisões semânticas inválidas.".to_owned(),
                retryable: false,
            });
        }
        Err(error) => return Err(error.into()),
    };
    Ok(ImportRejectedResponse { imported_count })
}

#[tauri::command]
pub async fn remove_note_from_knowledge_index(
    state: tauri::State<'_, AppState>,
    note_id: String,
) -> Result<(), RelationCommandError> {
    state.relation_service.remove(&note_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backup_relation() -> RejectedRelationBackup {
        RejectedRelationBackup {
            first_note_id: "a".to_owned(),
            second_note_id: "b".to_owned(),
            first_content_hash: "a".repeat(64),
            second_content_hash: "b".repeat(64),
            pipeline_version: "pipeline".to_owned(),
            rejected_at: "2026-07-26T12:00:00Z".to_owned(),
        }
    }

    #[test]
    fn backup_relation_uses_camel_case_and_derives_its_internal_id() {
        let backup = backup_relation();
        let json = serde_json::to_value(&backup).expect("serialize");
        assert_eq!(json["firstNoteId"], "a");
        assert!(json.get("id").is_none());

        let domain = RejectedRelation::from(backup);
        assert_eq!(domain.id, relation_id("a", "b"));
        assert_eq!(domain.first_content_hash, "a".repeat(64));
    }
}
