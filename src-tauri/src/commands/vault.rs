use serde::Serialize;

use crate::{state::AppState, vault::VaultError};

/// Erro de comando do vault entregue ao frontend. Mantém `code` estável para o
/// front decidir o tratamento e `message` diagnóstica (valor + forma esperada).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCommandError {
    pub code: String,
    pub message: String,
}

impl From<VaultError> for VaultCommandError {
    fn from(error: VaultError) -> Self {
        Self {
            code: error_code(&error).to_owned(),
            message: error.to_string(),
        }
    }
}

fn error_code(error: &VaultError) -> &'static str {
    match error {
        VaultError::RootNotDirectory(_) => "vault_root_invalid",
        VaultError::UnsafeFileName(_) => "unsafe_file_name",
        VaultError::PathEscapesVault { .. } => "path_escapes_vault",
        VaultError::Io { .. } => "io_error",
    }
}

/// Um documento de nota lido do vault: nome de arquivo + HTML auto-contido.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub file_name: String,
    pub html: String,
}

/// Todos os documentos do vault de uma vez - usado só na reindexação, não no
/// carregamento normal (que passa pelo índice, sem tocar os arquivos pesados).
#[tauri::command]
pub async fn read_all_note_files(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<NoteFile>, VaultCommandError> {
    let documents = state.vault.read_all_documents()?;
    Ok(documents
        .into_iter()
        .map(|(file_name, html)| NoteFile { file_name, html })
        .collect())
}

/// HTML completo de uma nota, lido sob demanda ao abri-la.
#[tauri::command]
pub async fn read_note_file(
    state: tauri::State<'_, AppState>,
    file_name: String,
) -> Result<String, VaultCommandError> {
    Ok(state.vault.read_note(&file_name)?)
}
