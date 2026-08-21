use rusqlite::{params, OptionalExtension};

use crate::{
    database::Database,
    knowledge::domain::{
        relation_id, IndexingCheckpoint, NoteRelation, RejectedRelation, RelationKind,
        RelationOrigin,
    },
};

use super::RepositoryError;

pub trait RelationRepository: Send + Sync {
    fn get_for_note(&self, note_id: &str) -> Result<Vec<NoteRelation>, RepositoryError>;
    fn replace_automatic_for_note(
        &self,
        note_id: &str,
        relations: &[NoteRelation],
    ) -> Result<(), RepositoryError>;
    fn get_rejected(
        &self,
        first_note_id: &str,
        second_note_id: &str,
    ) -> Result<Option<RejectedRelation>, RepositoryError>;
    fn get_rejected_for_note(
        &self,
        note_id: &str,
    ) -> Result<Vec<RejectedRelation>, RepositoryError>;
    fn list_rejected(&self) -> Result<Vec<RejectedRelation>, RepositoryError>;
    fn put_rejected(&self, rejected: &RejectedRelation) -> Result<(), RepositoryError>;
    fn put_rejected_many(&self, rejected: &[RejectedRelation]) -> Result<usize, RepositoryError>;
    fn delete_rejected(&self, relation_id: &str) -> Result<(), RepositoryError>;
    fn delete_relation(&self, relation_id: &str) -> Result<(), RepositoryError>;
    fn delete_for_note(&self, note_id: &str) -> Result<(), RepositoryError>;
    fn get_checkpoint(&self) -> Result<Option<IndexingCheckpoint>, RepositoryError>;
    fn put_checkpoint(&self, checkpoint: &IndexingCheckpoint) -> Result<(), RepositoryError>;
}

#[derive(Clone)]
pub struct SqliteRelationRepository {
    database: Database,
}

impl SqliteRelationRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }
}

impl RelationRepository for SqliteRelationRepository {
    fn get_for_note(&self, note_id: &str) -> Result<Vec<NoteRelation>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, first_note_id, second_note_id, score, origin, kind,
                        model_id, pipeline_version, first_revision, second_revision,
                        created_at, updated_at
                 FROM note_relations
                 WHERE first_note_id = ?1 OR second_note_id = ?1
                 ORDER BY score DESC, id",
            )?;
            let relations = statement
                .query_map([note_id], map_relation)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(relations)
        })?)
    }

    fn replace_automatic_for_note(
        &self,
        note_id: &str,
        relations: &[NoteRelation],
    ) -> Result<(), RepositoryError> {
        if relations.iter().any(|relation| {
            relation.origin != RelationOrigin::Automatic
                || relation.first_note_id >= relation.second_note_id
                || !relation.score.is_finite()
                || (relation.first_note_id != note_id && relation.second_note_id != note_id)
        }) {
            return Err(RepositoryError::InvalidData);
        }

        self.database.with_transaction(|transaction| {
            transaction.execute(
                "DELETE FROM note_relations
                 WHERE origin = 'automatic' AND (first_note_id = ?1 OR second_note_id = ?1)",
                [note_id],
            )?;
            let mut statement = transaction.prepare_cached(
                "INSERT INTO note_relations (
                    id, first_note_id, second_note_id, score, origin, kind,
                    model_id, pipeline_version, first_revision, second_revision,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    score = excluded.score,
                    model_id = excluded.model_id,
                    pipeline_version = excluded.pipeline_version,
                    first_revision = excluded.first_revision,
                    second_revision = excluded.second_revision,
                    updated_at = excluded.updated_at
                 WHERE note_relations.origin = 'automatic'",
            )?;
            for relation in relations {
                statement.execute(params![
                    relation.id,
                    relation.first_note_id,
                    relation.second_note_id,
                    relation.score,
                    relation_origin_value(relation.origin),
                    relation_kind_value(relation.kind),
                    relation.model_id,
                    relation.pipeline_version,
                    relation.first_revision,
                    relation.second_revision,
                    relation.created_at,
                    relation.updated_at,
                ])?;
            }
            Ok(())
        })?;
        Ok(())
    }

    fn get_rejected(
        &self,
        first_note_id: &str,
        second_note_id: &str,
    ) -> Result<Option<RejectedRelation>, RepositoryError> {
        let id = relation_id(first_note_id, second_note_id);
        Ok(self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT id, first_note_id, second_note_id, first_content_hash,
                            second_content_hash, pipeline_version, rejected_at
                     FROM rejected_note_relations WHERE id = ?1",
                    [id],
                    map_rejected,
                )
                .optional()
        })?)
    }

    fn get_rejected_for_note(
        &self,
        note_id: &str,
    ) -> Result<Vec<RejectedRelation>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, first_note_id, second_note_id, first_content_hash,
                        second_content_hash, pipeline_version, rejected_at
                 FROM rejected_note_relations
                 WHERE first_note_id = ?1 OR second_note_id = ?1
                 ORDER BY id",
            )?;
            let rejected = statement
                .query_map([note_id], map_rejected)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rejected)
        })?)
    }

    fn list_rejected(&self) -> Result<Vec<RejectedRelation>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, first_note_id, second_note_id, first_content_hash,
                        second_content_hash, pipeline_version, rejected_at
                 FROM rejected_note_relations
                 ORDER BY id",
            )?;
            let rejected = statement
                .query_map([], map_rejected)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rejected)
        })?)
    }

    fn put_rejected(&self, rejected: &RejectedRelation) -> Result<(), RepositoryError> {
        if !valid_rejected_relation(rejected) {
            return Err(RepositoryError::InvalidData);
        }
        self.database.with_connection(|connection| {
            write_rejected(connection, rejected)?;
            Ok(())
        })?;
        Ok(())
    }

    fn put_rejected_many(&self, rejected: &[RejectedRelation]) -> Result<usize, RepositoryError> {
        if rejected.iter().any(|item| !valid_rejected_relation(item)) {
            return Err(RepositoryError::InvalidData);
        }
        Ok(self.database.with_transaction(|transaction| {
            for item in rejected {
                write_rejected(transaction, item)?;
            }
            Ok(rejected.len())
        })?)
    }

    fn delete_rejected(&self, relation_id: &str) -> Result<(), RepositoryError> {
        self.database.with_connection(|connection| {
            connection.execute(
                "DELETE FROM rejected_note_relations WHERE id = ?1",
                [relation_id],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    fn delete_relation(&self, relation_id: &str) -> Result<(), RepositoryError> {
        self.database.with_connection(|connection| {
            connection.execute("DELETE FROM note_relations WHERE id = ?1", [relation_id])?;
            Ok(())
        })?;
        Ok(())
    }

    fn delete_for_note(&self, note_id: &str) -> Result<(), RepositoryError> {
        self.database.with_transaction(|transaction| {
            transaction.execute("DELETE FROM note_embeddings WHERE note_id = ?1", [note_id])?;
            transaction.execute(
                "DELETE FROM note_relations WHERE first_note_id = ?1 OR second_note_id = ?1",
                [note_id],
            )?;
            transaction.execute(
                "DELETE FROM rejected_note_relations
                 WHERE first_note_id = ?1 OR second_note_id = ?1",
                [note_id],
            )?;
            transaction.execute("DELETE FROM knowledge_notes WHERE id = ?1", [note_id])?;
            Ok(())
        })?;
        Ok(())
    }

    fn get_checkpoint(&self) -> Result<Option<IndexingCheckpoint>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT pipeline_version, processed_count, total_count, status,
                            last_processed_note_id, updated_at
                     FROM relation_indexing_state WHERE id = 1",
                    [],
                    |row| {
                        let processed: i64 = row.get(1)?;
                        let total: i64 = row.get(2)?;
                        Ok(IndexingCheckpoint {
                            pipeline_version: row.get(0)?,
                            processed_count: usize::try_from(processed).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    1,
                                    rusqlite::types::Type::Integer,
                                    Box::new(error),
                                )
                            })?,
                            total_count: usize::try_from(total).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    2,
                                    rusqlite::types::Type::Integer,
                                    Box::new(error),
                                )
                            })?,
                            status: row.get(3)?,
                            last_processed_note_id: row.get(4)?,
                            updated_at: row.get(5)?,
                        })
                    },
                )
                .optional()
        })?)
    }

    fn put_checkpoint(&self, checkpoint: &IndexingCheckpoint) -> Result<(), RepositoryError> {
        let processed_count = i64::try_from(checkpoint.processed_count)?;
        let total_count = i64::try_from(checkpoint.total_count)?;
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO relation_indexing_state (
                    id, pipeline_version, processed_count, total_count, status,
                    last_processed_note_id, updated_at
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    pipeline_version = excluded.pipeline_version,
                    processed_count = excluded.processed_count,
                    total_count = excluded.total_count,
                    status = excluded.status,
                    last_processed_note_id = excluded.last_processed_note_id,
                    updated_at = excluded.updated_at",
                params![
                    checkpoint.pipeline_version,
                    processed_count,
                    total_count,
                    checkpoint.status,
                    checkpoint.last_processed_note_id,
                    checkpoint.updated_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(())
    }
}

fn map_relation(row: &rusqlite::Row<'_>) -> Result<NoteRelation, rusqlite::Error> {
    let score: f32 = row.get(3)?;
    if !score.is_finite() {
        return Err(invalid_text_value(3, "non-finite relation score"));
    }
    let origin: String = row.get(4)?;
    let kind: String = row.get(5)?;
    Ok(NoteRelation {
        id: row.get(0)?,
        first_note_id: row.get(1)?,
        second_note_id: row.get(2)?,
        score,
        origin: match origin.as_str() {
            "automatic" => RelationOrigin::Automatic,
            "manual" => RelationOrigin::Manual,
            _ => return Err(invalid_text_value(4, "unknown relation origin")),
        },
        kind: match kind.as_str() {
            "semantic" => RelationKind::Semantic,
            _ => return Err(invalid_text_value(5, "unknown relation kind")),
        },
        model_id: row.get(6)?,
        pipeline_version: row.get(7)?,
        first_revision: row.get(8)?,
        second_revision: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_rejected(row: &rusqlite::Row<'_>) -> Result<RejectedRelation, rusqlite::Error> {
    Ok(RejectedRelation {
        id: row.get(0)?,
        first_note_id: row.get(1)?,
        second_note_id: row.get(2)?,
        first_content_hash: row.get(3)?,
        second_content_hash: row.get(4)?,
        pipeline_version: row.get(5)?,
        rejected_at: row.get(6)?,
    })
}

fn valid_rejected_relation(rejected: &RejectedRelation) -> bool {
    rejected.first_note_id < rejected.second_note_id
        && !rejected.first_note_id.is_empty()
        && rejected.first_note_id.len() <= 256
        && rejected.second_note_id.len() <= 256
        && rejected.id == relation_id(&rejected.first_note_id, &rejected.second_note_id)
        && valid_sha256(&rejected.first_content_hash)
        && valid_sha256(&rejected.second_content_hash)
        && !rejected.pipeline_version.is_empty()
        && rejected.pipeline_version.len() <= 256
        && chrono::DateTime::parse_from_rfc3339(&rejected.rejected_at).is_ok()
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn write_rejected(
    connection: &rusqlite::Connection,
    rejected: &RejectedRelation,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO rejected_note_relations (
            id, first_note_id, second_note_id, first_content_hash,
            second_content_hash, pipeline_version, rejected_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            first_content_hash = excluded.first_content_hash,
            second_content_hash = excluded.second_content_hash,
            pipeline_version = excluded.pipeline_version,
            rejected_at = excluded.rejected_at",
        params![
            rejected.id,
            rejected.first_note_id,
            rejected.second_note_id,
            rejected.first_content_hash,
            rejected.second_content_hash,
            rejected.pipeline_version,
            rejected.rejected_at,
        ],
    )?;
    Ok(())
}

fn relation_origin_value(origin: RelationOrigin) -> &'static str {
    match origin {
        RelationOrigin::Automatic => "automatic",
        RelationOrigin::Manual => "manual",
    }
}

fn relation_kind_value(kind: RelationKind) -> &'static str {
    match kind {
        RelationKind::Semantic => "semantic",
    }
}

fn invalid_text_value(index: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relation(first: &str, second: &str, origin: RelationOrigin) -> NoteRelation {
        NoteRelation {
            id: relation_id(first, second),
            first_note_id: first.to_owned(),
            second_note_id: second.to_owned(),
            score: 0.9,
            origin,
            kind: RelationKind::Semantic,
            model_id: "model".to_owned(),
            pipeline_version: "pipeline".to_owned(),
            first_revision: "r1".to_owned(),
            second_revision: "r1".to_owned(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn insert_relation(database: &Database, relation: &NoteRelation) {
        database
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO note_relations (
                        id, first_note_id, second_note_id, score, origin, kind,
                        model_id, pipeline_version, first_revision, second_revision,
                        created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        relation.id,
                        relation.first_note_id,
                        relation.second_note_id,
                        relation.score,
                        relation_origin_value(relation.origin),
                        relation_kind_value(relation.kind),
                        relation.model_id,
                        relation.pipeline_version,
                        relation.first_revision,
                        relation.second_revision,
                        relation.created_at,
                        relation.updated_at,
                    ],
                )?;
                Ok(())
            })
            .expect("insert");
    }

    fn rejected(first: &str, second: &str) -> RejectedRelation {
        RejectedRelation {
            id: relation_id(first, second),
            first_note_id: first.to_owned(),
            second_note_id: second.to_owned(),
            first_content_hash: "a".repeat(64),
            second_content_hash: "b".repeat(64),
            pipeline_version: "pipeline".to_owned(),
            rejected_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn replacement_removes_old_automatic_relations_and_preserves_manual_ones() {
        let database = Database::open_in_memory().expect("database");
        let repository = SqliteRelationRepository::new(database.clone());
        insert_relation(&database, &relation("a", "b", RelationOrigin::Automatic));
        insert_relation(&database, &relation("a", "c", RelationOrigin::Manual));

        repository
            .replace_automatic_for_note("a", &[relation("a", "d", RelationOrigin::Automatic)])
            .expect("replace");

        let relations = repository.get_for_note("a").expect("relations");
        assert_eq!(relations.len(), 2);
        assert!(relations
            .iter()
            .any(|item| item.second_note_id == "c" && item.origin == RelationOrigin::Manual));
        assert!(relations
            .iter()
            .any(|item| item.second_note_id == "d" && item.origin == RelationOrigin::Automatic));
        assert!(!relations.iter().any(|item| item.second_note_id == "b"));
    }

    #[test]
    fn rejection_and_checkpoint_round_trip() {
        let database = Database::open_in_memory().expect("database");
        let repository = SqliteRelationRepository::new(database);
        let rejected = rejected("a", "b");
        repository.put_rejected(&rejected).expect("reject");
        assert_eq!(
            repository.get_rejected("b", "a").expect("get"),
            Some(rejected)
        );

        let checkpoint = IndexingCheckpoint {
            pipeline_version: "pipeline".to_owned(),
            processed_count: 2,
            total_count: 5,
            status: "paused".to_owned(),
            last_processed_note_id: Some("a".to_owned()),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        };
        repository.put_checkpoint(&checkpoint).expect("checkpoint");
        assert_eq!(repository.get_checkpoint().expect("get"), Some(checkpoint));
    }

    #[test]
    fn rejected_relations_export_and_import_as_an_atomic_batch() {
        let database = Database::open_in_memory().expect("database");
        let repository = SqliteRelationRepository::new(database);
        let first = rejected("a", "b");
        let second = rejected("a", "c");

        assert_eq!(
            repository
                .put_rejected_many(&[second.clone(), first.clone()])
                .expect("import"),
            2
        );
        let mut expected = vec![second, first];
        expected.sort_by(|left, right| left.id.cmp(&right.id));
        assert_eq!(repository.list_rejected().expect("export"), expected);

        let mut invalid = rejected("b", "c");
        invalid.first_content_hash = "not-a-sha256".to_owned();
        assert!(matches!(
            repository.put_rejected_many(&[invalid]),
            Err(RepositoryError::InvalidData)
        ));
        assert_eq!(repository.list_rejected().expect("unchanged").len(), 2);
    }
}
