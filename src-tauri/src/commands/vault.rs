use std::process::Command;

use serde::Serialize;

use crate::{
    database::DatabaseError,
    note_index::{NoteIndexRow, SqliteNoteIndex},
    state::AppState,
    vault::{VaultError, VaultStore},
};

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

impl From<DatabaseError> for VaultCommandError {
    fn from(error: DatabaseError) -> Self {
        Self {
            code: "index_error".to_owned(),
            message: error.to_string(),
        }
    }
}

fn error_code(error: &VaultError) -> &'static str {
    match error {
        VaultError::RootNotDirectory(_) => "vault_root_invalid",
        VaultError::UnsafeFileName(_) => "unsafe_file_name",
        VaultError::PathEscapesVault { .. } => "path_escapes_vault",
        VaultError::UnsafeFileType(_) => "unsafe_file_type",
        VaultError::LockPoisoned => "vault_lock_poisoned",
        VaultError::Io { .. } => "io_error",
    }
}

/// Um documento de nota lido do vault: nome de arquivo + HTML auto-contido.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub file_name: String,
    pub html: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFileFingerprint {
    pub file_name: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root_path: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

/// Informações físicas que tornam a propriedade do vault visível na interface.
#[tauri::command]
pub async fn get_vault_info(
    state: tauri::State<'_, AppState>,
) -> Result<VaultInfo, VaultCommandError> {
    let (file_count, total_bytes) = state.vault.statistics()?;
    Ok(VaultInfo {
        root_path: state.vault.root().display().to_string(),
        file_count,
        total_bytes,
    })
}

/// Abre o diretório no Explorer. O caminho vem do estado construído pela
/// aplicação, não de entrada arbitrária do frontend.
#[tauri::command]
pub async fn open_vault_folder(state: tauri::State<'_, AppState>) -> Result<(), VaultCommandError> {
    Command::new("explorer.exe")
        .arg(state.vault.root())
        .spawn()
        .map_err(|source| VaultError::io("open", state.vault.root(), source))?;
    Ok(())
}

/// Adota um HTML que ainda não pertence ao índice, preservando seu nome
/// físico. O hash impede que uma edição concorrente seja sobrescrita entre a
/// prévia na interface e a confirmação do usuário.
#[tauri::command]
pub async fn adopt_note_file(
    state: tauri::State<'_, AppState>,
    row: NoteIndexRow,
    expected_hash: String,
    html: String,
) -> Result<(), VaultCommandError> {
    adopt_note_document(&state.vault, &state.note_index, row, &expected_hash, &html)
}

fn adopt_note_document(
    vault: &VaultStore,
    note_index: &SqliteNoteIndex,
    mut row: NoteIndexRow,
    expected_hash: &str,
    html: &str,
) -> Result<(), VaultCommandError> {
    if note_index.file_record(&row.id)?.is_some() {
        return Err(VaultCommandError {
            code: "adopt_id_exists".to_owned(),
            message: format!("note id '{}' is already indexed", row.id),
        });
    }
    if note_index.id_for_file_name(&row.file_name)?.is_some() {
        return Err(VaultCommandError {
            code: "adopt_file_indexed".to_owned(),
            message: format!("file '{}' is already indexed", row.file_name),
        });
    }

    let actual_hash = vault.note_hash(&row.file_name)?;
    if actual_hash != expected_hash {
        return Err(VaultCommandError {
            code: "vault_content_changed".to_owned(),
            message: format!("file '{}' changed before adoption", row.file_name),
        });
    }

    vault.write_note(&row.file_name, html)?;
    row.content_hash = vault.note_hash(&row.file_name)?;
    note_index.upsert(&row)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use crate::{
        database::Database,
        note_index::{IndexConnection, NoteIndexRow, SqliteNoteIndex},
        vault::VaultStore,
    };

    use super::adopt_note_document;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fixture() -> (VaultStore, SqliteNoteIndex) {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("hz-adopt-{}-{unique}", std::process::id()));
        let vault = VaultStore::open(root.join("vault")).expect("vault");
        let database = Database::open(&root.join("index.sqlite")).expect("database");
        (vault, SqliteNoteIndex::new(database))
    }

    fn row() -> NoteIndexRow {
        NoteIndexRow {
            id: "adopted-id".to_owned(),
            file_name: "manual.html".to_owned(),
            title: "Manual".to_owned(),
            folder: "inbox".to_owned(),
            kind: "fleeting".to_owned(),
            template: "blank".to_owned(),
            status: "saved".to_owned(),
            plain_text: "conteúdo".to_owned(),
            content_hash: String::new(),
            created_at: "2026-07-26T20:00:00.000Z".to_owned(),
            updated_at: "2026-07-26T20:00:00.000Z".to_owned(),
            connections: Vec::<IndexConnection>::new(),
        }
    }

    #[test]
    fn adoption_preserves_name_and_indexes_the_new_identity() {
        let (vault, index) = fixture();
        let original = "<html><body>manual</body></html>";
        let adopted = r#"<meta name="hz:id" content="adopted-id"><p>conteúdo</p>"#;
        vault.write_note("manual.html", original).unwrap();
        let expected_hash = vault.note_hash("manual.html").unwrap();

        adopt_note_document(&vault, &index, row(), &expected_hash, adopted).unwrap();

        assert_eq!(vault.read_note("manual.html").unwrap(), adopted);
        assert_eq!(
            index.file_record("adopted-id").unwrap().unwrap().0,
            "manual.html"
        );
    }

    #[test]
    fn adoption_rejects_a_changed_file_without_overwriting_it() {
        let (vault, index) = fixture();
        let original = "<html><body>original</body></html>";
        vault.write_note("manual.html", original).unwrap();

        let error = adopt_note_document(
            &vault,
            &index,
            row(),
            "outdated-hash",
            r#"<meta name="hz:id" content="adopted-id">"#,
        )
        .unwrap_err();

        assert_eq!(error.code, "vault_content_changed");
        assert_eq!(vault.read_note("manual.html").unwrap(), original);
        assert!(index.file_record("adopted-id").unwrap().is_none());
    }
}

/// Nomes físicos dos documentos no vault, sem ler o conteúdo pesado. Usado
/// para detectar arquivos adicionados, removidos ou renomeados fora do app.
#[tauri::command]
pub async fn list_note_files(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<NoteFileFingerprint>, VaultCommandError> {
    Ok(state
        .vault
        .list_note_fingerprints()?
        .into_iter()
        .map(|(file_name, content_hash)| NoteFileFingerprint {
            file_name,
            content_hash,
        })
        .collect())
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
        .map(|(file_name, html, content_hash)| NoteFile {
            file_name,
            html,
            content_hash,
        })
        .collect())
}
