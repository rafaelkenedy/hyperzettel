use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use thiserror::Error;

/// Erros do armazenamento de notas em arquivo. Cada variante inclui o valor
/// ofensor e a forma esperada, para diagnóstico (ver guia de estilo).
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault root '{0}' is not a directory")]
    RootNotDirectory(String),
    #[error("note file name '{0}' is unsafe: expected a bare '<slug>--<id>.html' with no path separators or '..'")]
    UnsafeFileName(String),
    #[error("resolved note path '{resolved}' escaped the vault root '{root}'")]
    PathEscapesVault { resolved: String, root: String },
    #[error("failed to {action} note file '{path}': {source}")]
    Io {
        action: &'static str,
        path: String,
        #[source]
        source: std::io::Error,
    },
}

impl VaultError {
    fn io(action: &'static str, path: &Path, source: std::io::Error) -> Self {
        Self::Io {
            action,
            path: path.display().to_string(),
            source,
        }
    }
}

/// Armazena cada nota como um arquivo `.html` auto-contido (ADR 0006).
///
/// A raiz do vault é injetada no construtor; todo caminho é validado contra ela
/// antes de qualquer operação, então o store é a única fronteira de filesystem.
#[derive(Debug, Clone)]
pub struct VaultStore {
    root: PathBuf,
}

impl VaultStore {
    /// Abre o vault, criando a raiz se necessário e exigindo que seja um diretório.
    ///
    /// ```no_run
    /// use std::path::PathBuf;
    /// use hyperzettel_lib::vault::VaultStore;
    /// let store = VaultStore::open(PathBuf::from("/data/vault")).unwrap();
    /// ```
    pub fn open(root: PathBuf) -> Result<Self, VaultError> {
        fs::create_dir_all(&root).map_err(|source| VaultError::io("create vault root", &root, source))?;
        if !root.is_dir() {
            return Err(VaultError::RootNotDirectory(root.display().to_string()));
        }
        Ok(Self { root })
    }

    /// Grava o documento de forma atômica (arquivo temporário + rename), para
    /// nunca deixar uma nota meio-escrita se o processo cair no meio.
    pub fn write_note(&self, file_name: &str, html: &str) -> Result<(), VaultError> {
        let path = self.safe_path(file_name)?;
        let temp = self.safe_path(&format!("{file_name}.tmp"))?;
        write_then_rename(&temp, &path, html)
    }

    /// Lê o documento HTML de uma nota pelo nome de arquivo.
    pub fn read_note(&self, file_name: &str) -> Result<String, VaultError> {
        let path = self.safe_path(file_name)?;
        fs::read_to_string(&path).map_err(|source| VaultError::io("read", &path, source))
    }

    /// Remove o arquivo de uma nota do vault.
    pub fn delete_note(&self, file_name: &str) -> Result<(), VaultError> {
        let path = self.safe_path(file_name)?;
        fs::remove_file(&path).map_err(|source| VaultError::io("delete", &path, source))
    }

    /// Lê todos os documentos do vault de uma vez (nome + html), para o
    /// carregamento inicial fazer um único IPC em vez de N leituras.
    pub fn read_all_documents(&self) -> Result<Vec<(String, String)>, VaultError> {
        self.list_note_files()?
            .into_iter()
            .map(|name| self.read_note(&name).map(|html| (name, html)))
            .collect()
    }

    /// Nomes dos arquivos `.html` na raiz do vault, ordenados (sem recursão).
    pub fn list_note_files(&self) -> Result<Vec<String>, VaultError> {
        let entries =
            fs::read_dir(&self.root).map_err(|source| VaultError::io("list", &self.root, source))?;
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|entry| html_file_name(&entry.path()))
            .collect();
        names.sort();
        Ok(names)
    }

    /// Resolve um nome de arquivo para um caminho garantidamente dentro da raiz.
    /// Rejeita separadores, `..` e qualquer coisa que não seja um nome simples.
    fn safe_path(&self, file_name: &str) -> Result<PathBuf, VaultError> {
        if !is_bare_file_name(file_name) {
            return Err(VaultError::UnsafeFileName(file_name.to_owned()));
        }
        let resolved = self.root.join(file_name);
        if !resolved.starts_with(&self.root) {
            return Err(VaultError::PathEscapesVault {
                resolved: resolved.display().to_string(),
                root: self.root.display().to_string(),
            });
        }
        Ok(resolved)
    }
}

/// Um nome de arquivo seguro é um único componente, sem separadores nem `..`.
fn is_bare_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && file_name != ".."
        && Path::new(file_name).components().count() == 1
}

/// Nome do arquivo se ele terminar em `.html`; caso contrário `None`.
fn html_file_name(path: &Path) -> Option<String> {
    if path.extension().and_then(|extension| extension.to_str()) != Some("html") {
        return None;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

/// Escreve o conteúdo num arquivo temporário e o renomeia por cima do final —
/// o rename é atômico na maioria dos sistemas de arquivos, garantindo que um
/// leitor nunca veja um documento parcial.
fn write_then_rename(temp: &Path, final_path: &Path, contents: &str) -> Result<(), VaultError> {
    let mut file =
        fs::File::create(temp).map_err(|source| VaultError::io("create temp file for", temp, source))?;
    file.write_all(contents.as_bytes())
        .map_err(|source| VaultError::io("write", temp, source))?;
    // Durabilidade best-effort; a atomicidade vem do rename, não do fsync.
    let _ = file.sync_all();
    fs::rename(temp, final_path)
        .map_err(|source| VaultError::io("rename temp file into", final_path, source))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Diretório temporário único por teste — mantém os testes independentes
    /// (F.I.R.S.T.) sem depender de uma crate de fixture.
    fn temp_vault() -> VaultStore {
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("hz-vault-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        VaultStore::open(root).expect("vault deve abrir")
    }

    #[test]
    fn write_then_read_round_trips() {
        let store = temp_vault();
        store.write_note("ideia--1.html", "<p>oi</p>").unwrap();
        assert_eq!(store.read_note("ideia--1.html").unwrap(), "<p>oi</p>");
    }

    #[test]
    fn write_overwrites_atomically() {
        let store = temp_vault();
        store.write_note("n--1.html", "v1").unwrap();
        store.write_note("n--1.html", "v2").unwrap();
        assert_eq!(store.read_note("n--1.html").unwrap(), "v2");
        // O arquivo temporário não deve sobrar.
        assert!(!store.list_note_files().unwrap().iter().any(|n| n.ends_with(".tmp")));
    }

    #[test]
    fn delete_removes_the_file() {
        let store = temp_vault();
        store.write_note("n--1.html", "x").unwrap();
        store.delete_note("n--1.html").unwrap();
        assert!(store.read_note("n--1.html").is_err());
    }

    #[test]
    fn list_returns_only_html_sorted() {
        let store = temp_vault();
        store.write_note("b--2.html", "x").unwrap();
        store.write_note("a--1.html", "x").unwrap();
        assert_eq!(
            store.list_note_files().unwrap(),
            vec!["a--1.html".to_owned(), "b--2.html".to_owned()]
        );
    }

    #[test]
    fn read_all_documents_pairs_name_and_html() {
        let store = temp_vault();
        store.write_note("a--1.html", "<p>um</p>").unwrap();
        store.write_note("b--2.html", "<p>dois</p>").unwrap();
        assert_eq!(
            store.read_all_documents().unwrap(),
            vec![
                ("a--1.html".to_owned(), "<p>um</p>".to_owned()),
                ("b--2.html".to_owned(), "<p>dois</p>".to_owned())
            ]
        );
    }

    #[test]
    fn rejects_unsafe_file_names() {
        let store = temp_vault();
        for unsafe_name in ["../escape.html", "sub/dir.html", "..", "", "a\\b.html"] {
            assert!(
                matches!(store.read_note(unsafe_name), Err(VaultError::UnsafeFileName(_))),
                "esperava rejeitar {unsafe_name:?}"
            );
        }
    }
}
