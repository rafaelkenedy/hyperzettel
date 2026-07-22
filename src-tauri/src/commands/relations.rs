use serde::Serialize;

use crate::{
    knowledge::{
        application::RelationServiceError,
        domain::{NoteRelation, RelationStatus},
        infrastructure::{IndexReason, KnowledgeNote},
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
pub async fn remove_note_from_knowledge_index(
    state: tauri::State<'_, AppState>,
    note_id: String,
) -> Result<(), RelationCommandError> {
    state.relation_service.remove(&note_id).await?;
    Ok(())
}
