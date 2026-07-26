use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use rusqlite::{Connection, Transaction};
use thiserror::Error;

const RELATIONS_MIGRATION: &str = include_str!("migrations/relations.sql");
const NOTE_INDEX_MIGRATION: &str = include_str!("migrations/note_index.sql");

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("failed to access the application database")]
    Sqlite(#[from] rusqlite::Error),
    #[error("failed to create the application data directory")]
    CreateDirectory(#[source] std::io::Error),
    #[error("application database lock is poisoned")]
    LockPoisoned,
}

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DatabaseError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(DatabaseError::CreateDirectory)?;
        }
        let connection = Connection::open(path)?;
        Self::initialize(connection)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, DatabaseError> {
        Self::initialize(Connection::open_in_memory()?)
    }

    fn initialize(connection: Connection) -> Result<Self, DatabaseError> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
        )?;
        connection.execute_batch(RELATIONS_MIGRATION)?;
        connection.execute_batch(NOTE_INDEX_MIGRATION)?;
        ensure_note_index_content_hash(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, DatabaseError> {
        let connection = self.lock()?;
        Ok(operation(&connection)?)
    }

    pub(crate) fn with_transaction<T>(
        &self,
        operation: impl FnOnce(&Transaction<'_>) -> Result<T, rusqlite::Error>,
    ) -> Result<T, DatabaseError> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let result = operation(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, DatabaseError> {
        self.connection
            .lock()
            .map_err(|_| DatabaseError::LockPoisoned)
    }
}

fn ensure_note_index_content_hash(connection: &Connection) -> Result<(), rusqlite::Error> {
    let mut statement = connection.prepare("PRAGMA table_info(note_index)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|column| column == "content_hash") {
        connection.execute(
            "ALTER TABLE note_index ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_note_index_file_name ON note_index(file_name)",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_creates_all_knowledge_tables() {
        let database = Database::open_in_memory().expect("database");
        let tables = database
            .with_connection(|connection| {
                let mut statement = connection
                    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .expect("tables");
        for table in [
            "knowledge_notes",
            "note_embeddings",
            "note_relations",
            "rejected_note_relations",
            "relation_indexing_state",
        ] {
            assert!(tables.iter().any(|candidate| candidate == table));
        }
    }

    #[test]
    fn upgrades_a_note_index_created_before_content_hashes() {
        let connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch(
                "CREATE TABLE note_index (
                    id TEXT PRIMARY KEY NOT NULL,
                    file_name TEXT NOT NULL
                );",
            )
            .expect("old schema");

        ensure_note_index_content_hash(&connection).expect("upgrade");

        let columns = connection
            .prepare("PRAGMA table_info(note_index)")
            .and_then(|mut statement| {
                statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .expect("columns");
        assert!(columns.iter().any(|column| column == "content_hash"));
    }
}
