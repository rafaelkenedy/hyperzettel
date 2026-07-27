use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

/// Teto por documento auto-contido. Imagens inseridas pelo app ocupam no
/// máximo ~1,8 MB cada; 25 MiB preservam um uso generoso sem permitir que um
/// único arquivo externo consuma memória sem limite na fronteira IPC.
pub const MAX_NOTE_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;

/// Erros do armazenamento de notas em arquivo. Cada variante inclui o valor
/// ofensor e a forma esperada, para diagnóstico (ver guia de estilo).
#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault root '{0}' is not a directory")]
    RootNotDirectory(String),
    #[error("note file name '{0}' is unsafe: expected a bare '.html' file name with no path separators or '..'")]
    UnsafeFileName(String),
    #[error("resolved note path '{resolved}' escaped the vault root '{root}'")]
    PathEscapesVault { resolved: String, root: String },
    #[error("note path '{0}' is a symbolic link or unsupported file type")]
    UnsafeFileType(String),
    #[error("note file '{file_name}' has {actual_bytes} bytes; the maximum is {max_bytes} bytes")]
    DocumentTooLarge {
        file_name: String,
        actual_bytes: u64,
        max_bytes: u64,
    },
    #[error("note file '{0}' changed while the operation was being prepared")]
    ContentChanged(String),
    #[error("vault write lock is poisoned")]
    LockPoisoned,
    #[error("failed to {action} note file '{path}': {source}")]
    Io {
        action: &'static str,
        path: String,
        #[source]
        source: std::io::Error,
    },
}

impl VaultError {
    pub(crate) fn io(action: &'static str, path: &Path, source: std::io::Error) -> Self {
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
    write_lock: Arc<Mutex<()>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultDocument {
    pub file_name: String,
    pub html: Option<String>,
    pub content_hash: String,
    pub size_bytes: u64,
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
        fs::create_dir_all(&root)
            .map_err(|source| VaultError::io("create vault root", &root, source))?;
        if !root.is_dir() {
            return Err(VaultError::RootNotDirectory(root.display().to_string()));
        }
        Ok(Self {
            root,
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    /// Caminho físico do vault. Exposto somente para informações ao usuário e
    /// para abrir a pasta; operações de nota continuam passando pelos métodos
    /// que validam cada nome.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Quantidade de documentos HTML e soma dos tamanhos físicos. Não lê o
    /// conteúdo, então pode alimentar a Central do Vault sem transferir notas.
    pub fn statistics(&self) -> Result<(usize, u64), VaultError> {
        let files = self.list_note_files()?;
        let mut total_bytes = 0_u64;
        for file_name in &files {
            let path = self.safe_note_path(file_name)?;
            let metadata =
                fs::metadata(&path).map_err(|source| VaultError::io("inspect", &path, source))?;
            total_bytes = total_bytes.saturating_add(metadata.len());
        }
        Ok((files.len(), total_bytes))
    }

    /// Grava o documento de forma atômica (arquivo temporário + rename), para
    /// nunca deixar uma nota meio-escrita se o processo cair no meio.
    pub fn write_note(&self, file_name: &str, html: &str) -> Result<(), VaultError> {
        validate_document_size(file_name, html.len() as u64)?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| VaultError::LockPoisoned)?;
        let path = self.safe_note_path(file_name)?;
        let temp = self.safe_path(&format!("{file_name}.{}.tmp", Uuid::new_v4()))?;
        write_then_rename(&temp, &path, html)
    }

    /// Substitui um documento somente se ele ainda tiver o hash observado por
    /// quem iniciou a operação. Revalida depois de preparar e sincronizar o
    /// temporário, imediatamente antes da publicação por `rename`.
    pub fn write_note_if_unchanged(
        &self,
        file_name: &str,
        expected_hash: &str,
        html: &str,
    ) -> Result<(), VaultError> {
        validate_document_size(file_name, html.len() as u64)?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| VaultError::LockPoisoned)?;
        let path = self.safe_note_path(file_name)?;
        assert_file_hash(&path, file_name, expected_hash)?;

        let temp = self.safe_path(&format!("{file_name}.{}.tmp", Uuid::new_v4()))?;
        write_temp(&temp, html)?;
        if let Err(error) = assert_file_hash(&path, file_name, expected_hash) {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        publish_temp(&temp, &path)
    }

    /// Cria uma nota somente se o nome ainda estiver livre. A checagem e a
    /// publicação são serializadas com as demais escritas deste vault.
    pub fn write_new_note(&self, file_name: &str, html: &str) -> Result<bool, VaultError> {
        validate_document_size(file_name, html.len() as u64)?;
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| VaultError::LockPoisoned)?;
        let path = self.safe_note_path(file_name)?;
        if path.exists() {
            return Ok(false);
        }
        let temp = self.safe_path(&format!("{file_name}.{}.tmp", Uuid::new_v4()))?;
        write_temp(&temp, html)?;
        publish_new_temp(&temp, &path)
    }

    /// Informa se um nome físico seguro já está ocupado no vault.
    pub fn note_exists(&self, file_name: &str) -> Result<bool, VaultError> {
        Ok(self.safe_note_path(file_name)?.is_file())
    }

    /// Lê o documento HTML de uma nota pelo nome de arquivo.
    pub fn read_note(&self, file_name: &str) -> Result<String, VaultError> {
        let path = self.safe_note_path(file_name)?;
        read_bounded_document(&path, file_name)
    }

    /// SHA-256 do documento físico atual, calculado em streaming para não
    /// carregar um arquivo externo inteiro na memória.
    pub fn note_hash(&self, file_name: &str) -> Result<String, VaultError> {
        let path = self.safe_note_path(file_name)?;
        hash_file(&path)
    }

    /// Nomes cujo conteúdo possui o hash informado.
    pub fn find_note_files_by_hash(&self, expected: &str) -> Result<Vec<String>, VaultError> {
        let mut matches = Vec::new();
        for file_name in self.list_note_files()? {
            if self.note_hash(&file_name)? == expected {
                matches.push(file_name);
            }
        }
        Ok(matches)
    }

    /// Remove o arquivo de uma nota do vault.
    pub fn delete_note(&self, file_name: &str) -> Result<(), VaultError> {
        let path = self.safe_note_path(file_name)?;
        fs::remove_file(&path).map_err(|source| VaultError::io("delete", &path, source))
    }

    /// Exclui somente a versão que foi observada. O hash é calculado sob o
    /// mesmo lock das mutações do processo e imediatamente antes do `remove`.
    pub fn delete_note_if_unchanged(
        &self,
        file_name: &str,
        expected_hash: &str,
    ) -> Result<(), VaultError> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| VaultError::LockPoisoned)?;
        let path = self.safe_note_path(file_name)?;
        assert_file_hash(&path, file_name, expected_hash)?;
        fs::remove_file(&path).map_err(|source| VaultError::io("delete", &path, source))
    }

    /// Lê todos os documentos do vault de uma vez (nome + html), para o
    /// carregamento inicial fazer um único IPC em vez de N leituras.
    pub fn read_all_documents(&self) -> Result<Vec<VaultDocument>, VaultError> {
        self.list_note_files()?
            .into_iter()
            .map(|name| {
                let path = self.safe_note_path(&name)?;
                let size_bytes = document_size(&path)?;
                if size_bytes > MAX_NOTE_DOCUMENT_BYTES {
                    return Ok(VaultDocument {
                        file_name: name,
                        html: None,
                        content_hash: oversized_fingerprint(size_bytes),
                        size_bytes,
                    });
                }
                let html = match read_bounded_document(&path, &name) {
                    Ok(html) => html,
                    Err(VaultError::DocumentTooLarge { actual_bytes, .. }) => {
                        return Ok(VaultDocument {
                            file_name: name,
                            html: None,
                            content_hash: oversized_fingerprint(actual_bytes),
                            size_bytes: actual_bytes,
                        });
                    }
                    Err(error) => return Err(error),
                };
                let content_hash = content_hash(html.as_bytes());
                Ok(VaultDocument {
                    file_name: name,
                    html: Some(html),
                    content_hash,
                    size_bytes,
                })
            })
            .collect()
    }

    /// Fingerprints atuais sem transferir o HTML pela fronteira IPC.
    pub fn list_note_fingerprints(&self) -> Result<Vec<(String, String)>, VaultError> {
        self.list_note_files()?
            .into_iter()
            .map(|name| {
                let path = self.safe_note_path(&name)?;
                let size_bytes = document_size(&path)?;
                let fingerprint = if size_bytes > MAX_NOTE_DOCUMENT_BYTES {
                    oversized_fingerprint(size_bytes)
                } else {
                    hash_file(&path)?
                };
                Ok((name, fingerprint))
            })
            .collect()
    }

    /// Nomes dos arquivos `.html` na raiz do vault, ordenados (sem recursão).
    pub fn list_note_files(&self) -> Result<Vec<String>, VaultError> {
        let entries = fs::read_dir(&self.root)
            .map_err(|source| VaultError::io("list", &self.root, source))?;
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|file_type| file_type.is_file() && !file_type.is_symlink())
                    .unwrap_or(false)
            })
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

    fn safe_note_path(&self, file_name: &str) -> Result<PathBuf, VaultError> {
        if !file_name.to_ascii_lowercase().ends_with(".html") {
            return Err(VaultError::UnsafeFileName(file_name.to_owned()));
        }
        let path = self.safe_path(file_name)?;
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
                return Err(VaultError::UnsafeFileType(path.display().to_string()));
            }
        }
        Ok(path)
    }
}

fn document_size(path: &Path) -> Result<u64, VaultError> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|source| VaultError::io("inspect", path, source))
}

fn validate_document_size(file_name: &str, actual_bytes: u64) -> Result<(), VaultError> {
    if actual_bytes > MAX_NOTE_DOCUMENT_BYTES {
        return Err(VaultError::DocumentTooLarge {
            file_name: file_name.to_owned(),
            actual_bytes,
            max_bytes: MAX_NOTE_DOCUMENT_BYTES,
        });
    }
    Ok(())
}

/// Lê no máximo `limite + 1`: mesmo se o arquivo crescer depois da consulta de
/// metadados, a alocação continua limitada e a corrida vira erro explícito.
fn read_bounded_document(path: &Path, file_name: &str) -> Result<String, VaultError> {
    let file = File::open(path).map_err(|source| VaultError::io("open", path, source))?;
    let initial_size = file
        .metadata()
        .map_err(|source| VaultError::io("inspect", path, source))?
        .len();
    validate_document_size(file_name, initial_size)?;

    let mut html = String::with_capacity(initial_size as usize);
    file.take(MAX_NOTE_DOCUMENT_BYTES + 1)
        .read_to_string(&mut html)
        .map_err(|source| VaultError::io("read", path, source))?;
    validate_document_size(file_name, html.len() as u64)?;
    Ok(html)
}

fn hash_file(path: &Path) -> Result<String, VaultError> {
    let file = File::open(path).map_err(|source| VaultError::io("open for hash", path, source))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher)
        .map_err(|source| VaultError::io("hash", path, source))?;
    Ok(hex::encode(hasher.finalize()))
}

fn assert_file_hash(path: &Path, file_name: &str, expected: &str) -> Result<(), VaultError> {
    match hash_file(path) {
        Ok(actual) if actual == expected => Ok(()),
        Ok(_) => Err(VaultError::ContentChanged(file_name.to_owned())),
        Err(VaultError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {
            Err(VaultError::ContentChanged(file_name.to_owned()))
        }
        Err(error) => Err(error),
    }
}

fn oversized_fingerprint(size_bytes: u64) -> String {
    format!("oversized:{size_bytes}")
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
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("html"))
    {
        return None;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

/// Escreve o conteúdo num arquivo temporário e o renomeia por cima do final -
/// o rename é atômico na maioria dos sistemas de arquivos, garantindo que um
/// leitor nunca veja um documento parcial.
fn write_then_rename(temp: &Path, final_path: &Path, contents: &str) -> Result<(), VaultError> {
    write_temp(temp, contents)?;
    publish_temp(temp, final_path)
}

fn write_temp(temp: &Path, contents: &str) -> Result<(), VaultError> {
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temp)
            .map_err(|source| VaultError::io("create temp file for", temp, source))?;
        file.write_all(contents.as_bytes())
            .map_err(|source| VaultError::io("write", temp, source))?;
        // Durabilidade best-effort; a atomicidade vem da publicação posterior.
        file.sync_all()
            .map_err(|source| VaultError::io("sync", temp, source))?;
        drop(file);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn publish_temp(temp: &Path, final_path: &Path) -> Result<(), VaultError> {
    let result = fs::rename(temp, final_path)
        .map_err(|source| VaultError::io("rename temp file into", final_path, source));
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

/// Publica um arquivo novo sem substituir um nome que outro processo tenha
/// criado durante a preparação. `hard_link` é atômico e falha com
/// `AlreadyExists`; remover o nome temporário mantém o mesmo inode no destino.
fn publish_new_temp(temp: &Path, final_path: &Path) -> Result<bool, VaultError> {
    let result = match fs::hard_link(temp, final_path) {
        Ok(()) => Ok(true),
        Err(source) if source.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(source) => Err(VaultError::io("publish new", final_path, source)),
    };
    let _ = fs::remove_file(temp);
    result
}

fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Diretório temporário único por teste - mantém os testes independentes
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
        assert!(!store
            .list_note_files()
            .unwrap()
            .iter()
            .any(|n| n.ends_with(".tmp")));
    }

    #[test]
    fn conditional_write_preserves_a_newer_external_version() {
        let store = temp_vault();
        store.write_note("nota.html", "versão observada").unwrap();
        let expected = store.note_hash("nota.html").unwrap();
        store.write_note("nota.html", "edição externa").unwrap();

        assert!(matches!(
            store.write_note_if_unchanged("nota.html", &expected, "rascunho local"),
            Err(VaultError::ContentChanged(file_name)) if file_name == "nota.html"
        ));
        assert_eq!(store.read_note("nota.html").unwrap(), "edição externa");
    }

    #[test]
    fn conditional_write_publishes_when_the_hash_still_matches() {
        let store = temp_vault();
        store.write_note("nota.html", "antes").unwrap();
        let expected = store.note_hash("nota.html").unwrap();

        store
            .write_note_if_unchanged("nota.html", &expected, "depois")
            .unwrap();

        assert_eq!(store.read_note("nota.html").unwrap(), "depois");
    }

    #[test]
    fn note_exists_checks_a_safe_physical_name() {
        let store = temp_vault();
        assert!(!store.note_exists("livre.html").unwrap());
        store.write_note("livre.html", "x").unwrap();
        assert!(store.note_exists("livre.html").unwrap());
    }

    #[test]
    fn new_publication_never_replaces_a_name_claimed_during_preparation() {
        let store = temp_vault();
        let final_path = store.safe_note_path("disputada.html").unwrap();
        let temp = store.safe_path("disputada.html.preparada.tmp").unwrap();
        write_temp(&temp, "conteúdo local").unwrap();
        fs::write(&final_path, "conteúdo externo").unwrap();

        assert!(!publish_new_temp(&temp, &final_path).unwrap());
        assert_eq!(fs::read_to_string(&final_path).unwrap(), "conteúdo externo");
        assert!(!temp.exists());
    }

    #[test]
    fn delete_removes_the_file() {
        let store = temp_vault();
        store.write_note("n--1.html", "x").unwrap();
        store.delete_note("n--1.html").unwrap();
        assert!(store.read_note("n--1.html").is_err());
    }

    #[test]
    fn conditional_delete_preserves_a_newer_external_version() {
        let store = temp_vault();
        store.write_note("nota.html", "versão observada").unwrap();
        let expected = store.note_hash("nota.html").unwrap();
        store.write_note("nota.html", "edição externa").unwrap();

        assert!(matches!(
            store.delete_note_if_unchanged("nota.html", &expected),
            Err(VaultError::ContentChanged(file_name)) if file_name == "nota.html"
        ));
        assert_eq!(store.read_note("nota.html").unwrap(), "edição externa");
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
    fn statistics_counts_only_vault_documents() {
        let store = temp_vault();
        store.write_note("a.html", "123").unwrap();
        store.write_note("b.HTML", "12345").unwrap();
        fs::write(store.root().join("ignorado.txt"), "fora").unwrap();

        assert_eq!(store.statistics().unwrap(), (2, 8));
    }

    #[test]
    fn read_all_documents_pairs_name_and_html() {
        let store = temp_vault();
        store.write_note("a--1.html", "<p>um</p>").unwrap();
        store.write_note("b--2.html", "<p>dois</p>").unwrap();
        assert_eq!(
            store.read_all_documents().unwrap(),
            vec![
                VaultDocument {
                    file_name: "a--1.html".to_owned(),
                    html: Some("<p>um</p>".to_owned()),
                    content_hash: content_hash(b"<p>um</p>"),
                    size_bytes: 9,
                },
                VaultDocument {
                    file_name: "b--2.html".to_owned(),
                    html: Some("<p>dois</p>".to_owned()),
                    content_hash: content_hash(b"<p>dois</p>"),
                    size_bytes: 11,
                }
            ]
        );
    }

    #[test]
    fn rejects_a_document_above_the_per_note_limit() {
        assert!(matches!(
            validate_document_size("grande.html", MAX_NOTE_DOCUMENT_BYTES + 1),
            Err(VaultError::DocumentTooLarge {
                actual_bytes,
                max_bytes: MAX_NOTE_DOCUMENT_BYTES,
                ..
            }) if actual_bytes == MAX_NOTE_DOCUMENT_BYTES + 1
        ));
    }

    #[test]
    fn isolates_an_oversized_external_document_without_reading_it() {
        let store = temp_vault();
        let path = store.root().join("externa.html");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_NOTE_DOCUMENT_BYTES + 1).unwrap();

        let documents = store.read_all_documents().unwrap();
        assert_eq!(
            documents,
            vec![VaultDocument {
                file_name: "externa.html".to_owned(),
                html: None,
                content_hash: oversized_fingerprint(MAX_NOTE_DOCUMENT_BYTES + 1),
                size_bytes: MAX_NOTE_DOCUMENT_BYTES + 1,
            }]
        );
        assert!(matches!(
            store.read_note("externa.html"),
            Err(VaultError::DocumentTooLarge { .. })
        ));
    }

    #[test]
    fn hashes_documents_in_streaming_mode() {
        let store = temp_vault();
        store.write_note("nota.html", "conteúdo").unwrap();
        assert_eq!(
            store.note_hash("nota.html").unwrap(),
            content_hash("conteúdo".as_bytes())
        );
    }

    #[test]
    fn accepts_uppercase_html_extension_when_reading_existing_files() {
        let store = temp_vault();
        store.write_note("MANUAL.HTML", "<p>manual</p>").unwrap();
        assert_eq!(
            store.list_note_files().unwrap(),
            vec!["MANUAL.HTML".to_owned()]
        );
        assert_eq!(store.read_note("MANUAL.HTML").unwrap(), "<p>manual</p>");
    }

    #[test]
    fn rejects_non_html_names_for_all_note_operations() {
        let store = temp_vault();
        assert!(matches!(
            store.write_note("nota.txt", "x"),
            Err(VaultError::UnsafeFileName(_))
        ));
        assert!(matches!(
            store.read_note("nota.txt"),
            Err(VaultError::UnsafeFileName(_))
        ));
    }

    #[test]
    fn rejects_unsafe_file_names() {
        let store = temp_vault();
        for unsafe_name in ["../escape.html", "sub/dir.html", "..", "", "a\\b.html"] {
            assert!(
                matches!(
                    store.read_note(unsafe_name),
                    Err(VaultError::UnsafeFileName(_))
                ),
                "esperava rejeitar {unsafe_name:?}"
            );
        }
    }
}
