use rusqlite::{params, OptionalExtension};

use crate::{
    database::Database,
    knowledge::domain::{embedding_from_blob, embedding_to_blob, NoteEmbedding, RELATION_CONFIG},
};

use super::RepositoryError;

pub trait EmbeddingRepository: Send + Sync {
    fn get(&self, note_id: &str) -> Result<Option<NoteEmbedding>, RepositoryError>;
    fn get_all(&self) -> Result<Vec<NoteEmbedding>, RepositoryError>;
    fn put(&self, embedding: &NoteEmbedding) -> Result<(), RepositoryError>;
    fn delete(&self, note_id: &str) -> Result<(), RepositoryError>;
}

#[derive(Clone)]
pub struct SqliteEmbeddingRepository {
    database: Database,
}

impl SqliteEmbeddingRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }
}

impl EmbeddingRepository for SqliteEmbeddingRepository {
    fn get(&self, note_id: &str) -> Result<Option<NoteEmbedding>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT note_id, vector, dimensions, content_hash, model_id,
                            model_variant, pipeline_version, source_revision,
                            truncated, input_tokens, created_at, updated_at
                     FROM note_embeddings WHERE note_id = ?1",
                    [note_id],
                    map_embedding,
                )
                .optional()
        })?)
    }

    fn get_all(&self) -> Result<Vec<NoteEmbedding>, RepositoryError> {
        Ok(self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT note_id, vector, dimensions, content_hash, model_id,
                        model_variant, pipeline_version, source_revision,
                        truncated, input_tokens, created_at, updated_at
                 FROM note_embeddings ORDER BY note_id",
            )?;
            let embeddings = statement
                .query_map([], map_embedding)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(embeddings)
        })?)
    }

    fn put(&self, embedding: &NoteEmbedding) -> Result<(), RepositoryError> {
        let vector = embedding_to_blob(&embedding.vector)?;
        let dimensions = i64::try_from(embedding.dimensions)?;
        let input_tokens = embedding.input_tokens.map(i64::try_from).transpose()?;
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO note_embeddings (
                    note_id, vector, dimensions, content_hash, model_id, model_variant,
                    pipeline_version, source_revision, truncated, input_tokens,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(note_id) DO UPDATE SET
                    vector = excluded.vector,
                    dimensions = excluded.dimensions,
                    content_hash = excluded.content_hash,
                    model_id = excluded.model_id,
                    model_variant = excluded.model_variant,
                    pipeline_version = excluded.pipeline_version,
                    source_revision = excluded.source_revision,
                    truncated = excluded.truncated,
                    input_tokens = excluded.input_tokens,
                    updated_at = excluded.updated_at",
                params![
                    embedding.note_id,
                    vector,
                    dimensions,
                    embedding.content_hash,
                    embedding.model_id,
                    embedding.model_variant,
                    embedding.pipeline_version,
                    embedding.source_revision,
                    embedding.truncated,
                    input_tokens,
                    embedding.created_at,
                    embedding.updated_at,
                ],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    fn delete(&self, note_id: &str) -> Result<(), RepositoryError> {
        self.database.with_connection(|connection| {
            connection.execute("DELETE FROM note_embeddings WHERE note_id = ?1", [note_id])?;
            Ok(())
        })?;
        Ok(())
    }
}

fn map_embedding(row: &rusqlite::Row<'_>) -> Result<NoteEmbedding, rusqlite::Error> {
    let blob: Vec<u8> = row.get(1)?;
    let dimensions_i64: i64 = row.get(2)?;
    let dimensions = usize::try_from(dimensions_i64).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })?;
    let vector = embedding_from_blob(&blob, dimensions, RELATION_CONFIG.persisted_dimensions)
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Blob,
                Box::new(error),
            )
        })?;
    let input_tokens_i64: Option<i64> = row.get(9)?;
    let input_tokens = input_tokens_i64
        .map(usize::try_from)
        .transpose()
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?;
    Ok(NoteEmbedding {
        note_id: row.get(0)?,
        vector,
        dimensions,
        content_hash: row.get(3)?,
        model_id: row.get(4)?,
        model_variant: row.get(5)?,
        pipeline_version: row.get(6)?,
        source_revision: row.get(7)?,
        truncated: row.get(8)?,
        input_tokens,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedding() -> NoteEmbedding {
        NoteEmbedding {
            note_id: "note".to_owned(),
            vector: vec![0.0625; RELATION_CONFIG.persisted_dimensions],
            dimensions: RELATION_CONFIG.persisted_dimensions,
            content_hash: "hash".to_owned(),
            model_id: RELATION_CONFIG.model_id.to_owned(),
            model_variant: RELATION_CONFIG.model_variant.to_owned(),
            pipeline_version: RELATION_CONFIG.pipeline_version.to_owned(),
            source_revision: "r1".to_owned(),
            truncated: false,
            input_tokens: Some(42),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn embedding_round_trip_uses_a_blob_and_preserves_metadata() {
        let database = Database::open_in_memory().expect("database");
        let repository = SqliteEmbeddingRepository::new(database.clone());
        let expected = embedding();
        repository.put(&expected).expect("put");
        assert_eq!(repository.get("note").expect("get"), Some(expected));
        let sqlite_type = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT typeof(vector) FROM note_embeddings WHERE note_id = 'note'",
                    [],
                    |row| row.get::<_, String>(0),
                )
            })
            .expect("type");
        assert_eq!(sqlite_type, "blob");
    }
}
