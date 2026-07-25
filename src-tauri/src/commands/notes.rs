//! Comandos de operação de nota que orquestram o vault (fonte da verdade) e o
//! índice SQLite (derivado). Os campos derivados (título, plainText, conexões)
//! chegam prontos do frontend, que já parseia o HTML.

use serde::Serialize;

use crate::{
    commands::vault::VaultCommandError,
    database::DatabaseError,
    note_index::NoteIndexRow,
    state::AppState,
    vault::VaultError,
};

/// Erro das operações de nota. `code` estável para o frontend; `message` traz o
/// valor ofensor e a forma esperada, vindo do erro de origem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommandError {
    pub code: String,
    pub message: String,
}

impl From<VaultError> for NoteCommandError {
    fn from(error: VaultError) -> Self {
        NoteCommandError::from(VaultCommandError::from(error))
    }
}

impl From<VaultCommandError> for NoteCommandError {
    fn from(error: VaultCommandError) -> Self {
        Self { code: error.code, message: error.message }
    }
}

impl From<DatabaseError> for NoteCommandError {
    fn from(error: DatabaseError) -> Self {
        Self { code: "index_error".to_owned(), message: error.to_string() }
    }
}

/// Grava a nota: primeiro o arquivo (fonte da verdade), depois o índice. Se o
/// índice falhar, o arquivo já está salvo e será recuperado na próxima
/// reindexação — nunca perdemos a nota por causa do índice.
#[tauri::command]
pub async fn save_note(
    state: tauri::State<'_, AppState>,
    row: NoteIndexRow,
    html: String,
) -> Result<(), NoteCommandError> {
    state.vault.write_note(&row.file_name, &html)?;
    state.note_index.upsert(&row)?;
    Ok(())
}

/// Remove a nota do vault e do índice.
#[tauri::command]
pub async fn delete_note(
    state: tauri::State<'_, AppState>,
    id: String,
    file_name: String,
) -> Result<(), NoteCommandError> {
    state.vault.delete_note(&file_name)?;
    state.note_index.delete(&id)?;
    Ok(())
}

/// Linhas do índice para montar a lista/grafo sem ler os arquivos pesados.
#[tauri::command]
pub async fn list_notes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<NoteIndexRow>, NoteCommandError> {
    Ok(state.note_index.list()?)
}

/// Ids das notas que casam com a busca, por relevância.
#[tauri::command]
pub async fn search_notes(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<String>, NoteCommandError> {
    Ok(state.note_index.search(&query)?)
}

/// Reconstrói o índice a partir das linhas derivadas do vault pelo frontend.
#[tauri::command]
pub async fn rebuild_note_index(
    state: tauri::State<'_, AppState>,
    rows: Vec<NoteIndexRow>,
) -> Result<(), NoteCommandError> {
    state.note_index.rebuild(&rows)?;
    Ok(())
}

/// Estado de retenção (revisão espaçada) como JSON, migrado do IndexedDB.
#[tauri::command]
pub async fn get_retention_state(
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, NoteCommandError> {
    Ok(state.note_index.get_retention()?)
}

#[tauri::command]
pub async fn set_retention_state(
    state: tauri::State<'_, AppState>,
    state_json: String,
) -> Result<(), NoteCommandError> {
    state.note_index.set_retention(&state_json)?;
    Ok(())
}
