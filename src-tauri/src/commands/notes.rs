//! Comandos de operação de nota que orquestram o vault (fonte da verdade) e o
//! índice SQLite (derivado). Os campos derivados (título, plainText, conexões)
//! chegam prontos do frontend, que já parseia o HTML.

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    commands::vault::VaultCommandError,
    database::DatabaseError,
    note_index::NoteIndexRow,
    state::AppState,
    vault::{VaultError, VaultStore},
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
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

impl From<DatabaseError> for NoteCommandError {
    fn from(error: DatabaseError) -> Self {
        Self {
            code: "index_error".to_owned(),
            message: error.to_string(),
        }
    }
}

/// Grava a nota: primeiro o arquivo (fonte da verdade), depois o índice. Se o
/// índice falhar, o arquivo já está salvo e será recuperado na próxima
/// reindexação - nunca perdemos a nota por causa do índice. Para uma nota já
/// indexada, preserva o nome físico encontrado no vault. Para uma nota nova,
/// amplia o id curto do nome proposto se outro arquivo já ocupar aquele nome.
#[tauri::command]
pub async fn save_note(
    state: tauri::State<'_, AppState>,
    mut row: NoteIndexRow,
    html: String,
) -> Result<(), NoteCommandError> {
    if !document_declares_id(&html, &row.id) {
        return Err(integrity_error(
            "vault_identity_mismatch",
            &format!("the note document does not declare hz:id '{}'", row.id),
        ));
    }
    let existing = state.note_index.file_record(&row.id)?;
    let is_existing = existing.is_some();
    row.file_name = match existing {
        Some((file_name, expected_hash)) => {
            resolve_indexed_file(&state, &row.id, &file_name, &expected_hash)?
        }
        None => write_new_note(&state.vault, &row.file_name, &row.id, &html)?,
    };
    if is_existing {
        state.vault.write_note(&row.file_name, &html)?;
    }
    row.content_hash = hash_html(&html);
    state.note_index.upsert(&row)?;
    Ok(())
}

fn file_name_candidates(preferred: &str, id: &str) -> Vec<String> {
    let stem = preferred.strip_suffix(".html").unwrap_or(preferred);
    let prefix = stem
        .rsplit_once("--")
        .map(|(prefix, _)| prefix)
        .unwrap_or(stem);
    let compact_id: String = id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();

    let mut candidates = vec![preferred.to_owned()];
    for length in [12_usize, 16, 24, 32, compact_id.len()] {
        if length <= 8 || length > compact_id.len() {
            continue;
        }
        let candidate = format!("{prefix}--{}.html", &compact_id[..length]);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }

    for suffix in 2..=10_000 {
        candidates.push(format!("{stem}--{suffix}.html"));
    }
    candidates
}

fn write_new_note(
    vault: &VaultStore,
    preferred: &str,
    id: &str,
    html: &str,
) -> Result<String, NoteCommandError> {
    for candidate in file_name_candidates(preferred, id) {
        if vault.note_exists(&candidate)? {
            let existing = vault.read_note(&candidate)?;
            if document_declares_id(&existing, id) {
                vault.write_note(&candidate, html)?;
                return Ok(candidate);
            }
            continue;
        }
        if vault.write_new_note(&candidate, html)? {
            return Ok(candidate);
        }
    }

    Err(NoteCommandError {
        code: "file_name_collision".to_owned(),
        message: format!("could not find an available file name for note '{id}'"),
    })
}

fn resolve_indexed_file(
    state: &AppState,
    id: &str,
    indexed_file_name: &str,
    expected_hash: &str,
) -> Result<String, NoteCommandError> {
    if expected_hash.is_empty() {
        return Err(integrity_error(
            "vault_reindex_required",
            "the note index predates file fingerprints; reindex the vault",
        ));
    }

    if state.vault.note_exists(indexed_file_name)? {
        let actual_hash = state.vault.note_hash(indexed_file_name)?;
        if actual_hash == expected_hash {
            return Ok(indexed_file_name.to_owned());
        }
        return Err(integrity_error(
            "vault_content_changed",
            &format!("note '{id}' changed outside the application"),
        ));
    }

    let matches = state.vault.find_note_files_by_hash(expected_hash)?;
    match matches.as_slice() {
        [renamed] => {
            state.note_index.update_file_name(id, renamed)?;
            Ok(renamed.clone())
        }
        [] => Err(integrity_error(
            "vault_file_missing",
            &format!("the file for note '{id}' was removed outside the application"),
        )),
        _ => Err(integrity_error(
            "vault_duplicate_content",
            &format!("multiple files match the indexed content of note '{id}'"),
        )),
    }
}

fn hash_html(html: &str) -> String {
    hex::encode(Sha256::digest(html.as_bytes()))
}

pub(crate) fn document_declares_id(html: &str, id: &str) -> bool {
    let escaped = id
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    html.contains(&format!("name=\"hz:id\" content=\"{escaped}\""))
}

fn integrity_error(code: &str, message: &str) -> NoteCommandError {
    NoteCommandError {
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_vault() -> VaultStore {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("hz-name-{}-{unique}", std::process::id()));
        VaultStore::open(root).expect("vault")
    }

    #[test]
    fn collision_extends_the_short_id_without_overwriting() {
        let vault = temp_vault();
        let preferred = "20260726-194530--minha-ideia--a1b2c3d4.html";
        let id = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";

        assert_eq!(file_name_candidates(preferred, id)[0], preferred.to_owned());
        let original = r#"<meta name="hz:id" content="different-id"><p>original</p>"#;
        vault.write_note(preferred, original).unwrap();

        assert_eq!(
            write_new_note(
                &vault,
                preferred,
                id,
                r#"<meta name="hz:id" content="a1b2c3d4-e5f6-4789-abcd-0123456789ab">"#,
            )
            .unwrap(),
            "20260726-194530--minha-ideia--a1b2c3d4e5f6.html"
        );
        assert_eq!(vault.read_note(preferred).unwrap(), original);
    }

    #[test]
    fn retry_after_index_failure_reuses_the_same_file() {
        let vault = temp_vault();
        let preferred = "20260726-194530--minha-ideia--a1b2c3d4.html";
        let id = "a1b2c3d4-e5f6-4789-abcd-0123456789ab";
        let first =
            r#"<meta name="hz:id" content="a1b2c3d4-e5f6-4789-abcd-0123456789ab"><p>v1</p>"#;
        let retry =
            r#"<meta name="hz:id" content="a1b2c3d4-e5f6-4789-abcd-0123456789ab"><p>v2</p>"#;

        assert_eq!(
            write_new_note(&vault, preferred, id, first).unwrap(),
            preferred
        );
        assert_eq!(
            write_new_note(&vault, preferred, id, retry).unwrap(),
            preferred
        );
        assert_eq!(vault.list_note_files().unwrap(), vec![preferred.to_owned()]);
        assert_eq!(vault.read_note(preferred).unwrap(), retry);
    }

    #[test]
    fn identity_check_rejects_a_row_that_disagrees_with_the_document() {
        assert!(document_declares_id(
            r#"<meta name="hz:id" content="expected-id">"#,
            "expected-id"
        ));
        assert!(!document_declares_id(
            r#"<meta name="hz:id" content="another-id">"#,
            "expected-id"
        ));
    }
}

fn indexed_file_record(state: &AppState, id: &str) -> Result<(String, String), NoteCommandError> {
    state
        .note_index
        .file_record(id)?
        .ok_or_else(|| NoteCommandError {
            code: "note_not_found".to_owned(),
            message: format!("note '{id}' is not present in the vault index"),
        })
}

/// Lê uma nota pelo id interno, resolvendo o nome físico através do índice.
#[tauri::command]
pub async fn read_note(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<String, NoteCommandError> {
    let (indexed_file_name, expected_hash) = indexed_file_record(&state, &id)?;
    let file_name = resolve_indexed_file(&state, &id, &indexed_file_name, &expected_hash)?;
    Ok(state.vault.read_note(&file_name)?)
}

/// Remove a nota pelo id interno, sem impor uma convenção ao nome físico.
#[tauri::command]
pub async fn delete_note(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), NoteCommandError> {
    let (indexed_file_name, expected_hash) = indexed_file_record(&state, &id)?;
    let file_name = resolve_indexed_file(&state, &id, &indexed_file_name, &expected_hash)?;
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
