use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::database::Database;

use super::RepositoryError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNote {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub revision: String,
    pub folder: String,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_deleted: bool,
    pub updated_at: String,
}

pub trait NoteRepository: Send + Sync {
    fn upsert_many(&self, notes: &[KnowledgeNote]) -> Result<usize, RepositoryError>;
    fn delete_missing(&self, retained_note_ids: &[String]) -> Result<usize, RepositoryError>;
    fn get(&self, note_id: &str) -> Result<Option<KnowledgeNote>, RepositoryError>;
    fn get_all_active(&self) -> Result<Vec<KnowledgeNote>, RepositoryError>;
    fn delete(&self, note_id: &str) -> Result<(), RepositoryError>;
}

#[derive(Clone)]
pub struct SqliteNoteRepository {
    database: Database,
}

impl SqliteNoteRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }
}

impl NoteRepository for SqliteNoteRepository {
    fn upsert_many(&self, notes: &[KnowledgeNote]) -> Result<usize, RepositoryError> {
        self.database.with_transaction(|transaction| {
            let mut statement = transaction.prepare_cached(
                "INSERT INTO knowledge_notes (
                    id, title, content, tags_json, revision, folder,
                    is_archived, is_deleted, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    tags_json = excluded.tags_json,
                    revision = excluded.revision,
                    folder = excluded.folder,
                    is_archived = excluded.is_archived,
                    is_deleted = excluded.is_deleted,
                    updated_at = excluded.updated_at",
            )?;
            for note in notes {
                let tags_json = serde_json::to_string(&note.tags)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
                statement.execute(params![
                    note.id,
                    note.title,
                    note.content,
                    tags_json,
                    note.revision,
                    note.folder,
                    note.is_archived,
                    note.is_deleted,
                    note.updated_at,
                ])?;
            }
            Ok(notes.len())
        })?;
        Ok(notes.len())
    }

    fn get(&self, note_id: &str) -> Result<Option<KnowledgeNote>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, title, content, tags_json, revision, folder,
                            is_archived, is_deleted, updated_at
                     FROM knowledge_notes WHERE id = ?1",
                    [note_id],
                    map_note,
                )
                .optional()
        })?)
    }

    fn delete_missing(&self, retained_note_ids: &[String]) -> Result<usize, RepositoryError> {
        let retained = retained_note_ids
            .iter()
            .collect::<std::collections::HashSet<_>>();
        Ok(self.database.with_transaction(|transaction| {
            let existing = {
                let mut statement = transaction.prepare("SELECT id FROM knowledge_notes")?;
                let rows = statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            let missing = existing
                .into_iter()
                .filter(|note_id| !retained.contains(note_id))
                .collect::<Vec<_>>();
            for note_id in &missing {
                transaction.execute("DELETE FROM note_embeddings WHERE note_id = ?1", [note_id])?;
                transaction.execute(
                    "DELETE FROM note_relations WHERE first_note_id = ?1 OR second_note_id = ?1",
                    [note_id],
                )?;
                transaction.execute(
                    "DELETE FROM rejected_note_relations WHERE first_note_id = ?1 OR second_note_id = ?1",
                    [note_id],
                )?;
                transaction.execute("DELETE FROM knowledge_notes WHERE id = ?1", [note_id])?;
            }
            Ok(missing.len())
        })?)
    }

    fn get_all_active(&self) -> Result<Vec<KnowledgeNote>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, title, content, tags_json, revision, folder,
                        is_archived, is_deleted, updated_at
                 FROM knowledge_notes
                 WHERE is_deleted = 0 AND is_archived = 0
                 ORDER BY updated_at, id",
            )?;
            let notes = statement
                .query_map([], map_note)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(notes)
        })?)
    }

    fn delete(&self, note_id: &str) -> Result<(), RepositoryError> {
        self.database.with_connection(|connection| {
            connection.execute("DELETE FROM knowledge_notes WHERE id = ?1", [note_id])?;
            Ok(())
        })?;
        Ok(())
    }
}

fn map_note(row: &rusqlite::Row<'_>) -> Result<KnowledgeNote, rusqlite::Error> {
    let tags_json: String = row.get(3)?;
    let tags = serde_json::from_str(&tags_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            tags_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(KnowledgeNote {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        tags,
        revision: row.get(4)?,
        folder: row.get(5)?,
        is_archived: row.get(6)?,
        is_deleted: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, archived: bool) -> KnowledgeNote {
        KnowledgeNote {
            id: id.to_owned(),
            title: format!("Note {id}"),
            content: "content".to_owned(),
            tags: vec!["rust".to_owned()],
            revision: "r1".to_owned(),
            folder: if archived { "archive" } else { "inbox" }.to_owned(),
            is_archived: archived,
            is_deleted: false,
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn upserts_reads_and_filters_the_note_mirror() {
        let database = Database::open_in_memory().expect("database");
        let repository = SqliteNoteRepository::new(database);
        repository
            .upsert_many(&[note("active", false), note("archived", true)])
            .expect("upsert");
        assert_eq!(
            repository.get("active").expect("get").expect("note").tags,
            vec!["rust"]
        );
        assert_eq!(repository.get_all_active().expect("active").len(), 1);
        repository.delete("active").expect("delete");
        assert!(repository.get("active").expect("get").is_none());

        repository
            .upsert_many(&[note("keep", false), note("remove", false)])
            .expect("upsert snapshot");
        assert_eq!(
            repository
                .delete_missing(&["keep".to_owned()])
                .expect("reconcile"),
            2
        );
        assert!(repository.get("keep").expect("get kept").is_some());
        assert!(repository.get("remove").expect("get removed").is_none());
    }
}
