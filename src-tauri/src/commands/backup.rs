//! Exportação de backup por diálogo nativo.
//!
//! O frontend entrega somente nome sugerido + JSON. O caminho nunca entra pelo
//! IPC: ele é escolhido dentro do backend, evitando transformar o comando numa
//! primitiva de escrita arbitrária para um WebView comprometido.

use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_BACKUP_BYTES: usize = 120_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReceipt {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCommandError {
    pub code: String,
    pub message: String,
}

fn backup_error(code: &str, message: impl Into<String>) -> BackupCommandError {
    BackupCommandError {
        code: code.to_owned(),
        message: message.into(),
    }
}

fn io_error(action: &str, path: &Path, source: std::io::Error) -> BackupCommandError {
    backup_error(
        "backup_io_error",
        format!(
            "failed to {action} backup file '{}': {source}",
            path.display()
        ),
    )
}

fn valid_suggested_name(name: &str) -> bool {
    !name.is_empty()
        && name.to_ascii_lowercase().ends_with(".json")
        && !name.contains('/')
        && !name.contains('\\')
        && Path::new(name).components().count() == 1
}

fn hash_file(path: &Path) -> Result<String, BackupCommandError> {
    let file =
        File::open(path).map_err(|source| io_error("open for verification", path, source))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher).map_err(|source| io_error("verify", path, source))?;
    Ok(hex::encode(hasher.finalize()))
}

fn write_verified_backup(path: &Path, contents: &str) -> Result<BackupReceipt, BackupCommandError> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err(backup_error(
            "backup_path_invalid",
            "selected backup destination must use the .json extension",
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        backup_error(
            "backup_path_invalid",
            format!("backup path '{}' has no parent directory", path.display()),
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            backup_error("backup_path_invalid", "backup file name is not valid UTF-8")
        })?;
    let temp = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let expected_hash = hex::encode(Sha256::digest(contents.as_bytes()));

    let write_result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|source| io_error("create temporary", &temp, source))?;
        file.write_all(contents.as_bytes())
            .map_err(|source| io_error("write", &temp, source))?;
        file.sync_all()
            .map_err(|source| io_error("sync", &temp, source))?;
        drop(file);
        fs::rename(&temp, path).map_err(|source| io_error("publish", path, source))
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }

    let metadata = fs::metadata(path).map_err(|source| io_error("inspect", path, source))?;
    let actual_hash = hash_file(path)?;
    if metadata.len() != contents.len() as u64 || actual_hash != expected_hash {
        return Err(backup_error(
            "backup_verification_failed",
            format!("backup file '{}' failed verification", path.display()),
        ));
    }

    Ok(BackupReceipt {
        path: path.display().to_string(),
        file_name: file_name.to_owned(),
        bytes: metadata.len(),
        sha256: actual_hash,
    })
}

/// Abre o seletor do sistema, grava, sincroniza e relê o backup. `None`
/// representa cancelamento e não deve atualizar a data do último backup.
#[tauri::command]
pub async fn save_backup_file(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<Option<BackupReceipt>, BackupCommandError> {
    if !valid_suggested_name(&suggested_name) {
        return Err(backup_error(
            "backup_name_invalid",
            "suggested backup name must be a bare .json file name",
        ));
    }
    if contents.len() > MAX_BACKUP_BYTES {
        return Err(backup_error(
            "backup_too_large",
            format!(
                "backup has {} bytes; maximum is {MAX_BACKUP_BYTES}",
                contents.len()
            ),
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Salvar backup verificado")
            .set_file_name(suggested_name)
            .add_filter("Backup JSON", &["json"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path: PathBuf = selected.into_path().map_err(|error| {
            backup_error(
                "backup_path_invalid",
                format!("selected backup destination is not a local path: {error}"),
            )
        })?;
        write_verified_backup(&path, &contents).map(Some)
    })
    .await
    .map_err(|error| backup_error("backup_task_failed", error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_path() -> PathBuf {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("hz-backup-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root.join("backup.json")
    }

    #[test]
    fn writes_syncs_and_verifies_the_selected_backup() {
        let path = temp_path();
        let contents = r#"{"format":"hyperzettelkasten","version":3}"#;

        let receipt = write_verified_backup(&path, contents).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        assert_eq!(receipt.file_name, "backup.json");
        assert_eq!(receipt.bytes, contents.len() as u64);
        assert_eq!(
            receipt.sha256,
            hex::encode(Sha256::digest(contents.as_bytes()))
        );
    }

    #[test]
    fn replaces_an_existing_destination_only_after_the_temp_is_synced() {
        let path = temp_path();
        fs::write(&path, "backup antigo").unwrap();

        write_verified_backup(&path, "backup novo").unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "backup novo");
    }

    #[test]
    fn rejects_unsafe_or_non_json_suggestions() {
        for name in ["", "../backup.json", "pasta\\backup.json", "backup.txt"] {
            assert!(!valid_suggested_name(name), "{name:?} deveria ser recusado");
        }
        assert!(valid_suggested_name("hyperzettel-notas-2026-07-27.json"));
    }

    #[test]
    fn refuses_to_write_a_non_json_destination() {
        let path = temp_path().with_extension("txt");
        let error = write_verified_backup(&path, "{}").unwrap_err();
        assert_eq!(error.code, "backup_path_invalid");
        assert!(!path.exists());
    }
}
