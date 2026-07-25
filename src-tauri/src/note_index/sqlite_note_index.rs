use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::database::{Database, DatabaseError};

/// Uma conexão declarada pela nota (id do alvo + motivo).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexConnection {
    pub id: String,
    pub reason: String,
}

/// Linha derivada de uma nota para o índice. Os campos vêm do frontend, que já
/// parseia o HTML; o Rust nunca interpreta HTML (evita duplicar o parser).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteIndexRow {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub folder: String,
    pub kind: String,
    pub template: String,
    pub status: String,
    pub plain_text: String,
    pub created_at: String,
    pub updated_at: String,
    pub connections: Vec<IndexConnection>,
}

/// Índice derivado das notas em SQLite (metadados + FTS5 + conexões + retenção).
/// A fonte da verdade continua sendo o vault; isto é reconstruível a partir dele.
#[derive(Clone)]
pub struct SqliteNoteIndex {
    database: Database,
}

impl SqliteNoteIndex {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    /// Insere ou atualiza uma nota no índice (metadados, busca e conexões) numa
    /// única transação, para o índice nunca ficar parcialmente atualizado.
    pub fn upsert(&self, row: &NoteIndexRow) -> Result<(), DatabaseError> {
        self.database.with_transaction(|tx| {
            write_metadata(tx, row)?;
            write_search(tx, row)?;
            write_connections(tx, row)
        })
    }

    /// Remove a nota do índice em todas as tabelas.
    pub fn delete(&self, id: &str) -> Result<(), DatabaseError> {
        self.database.with_transaction(|tx| {
            tx.execute("DELETE FROM note_index WHERE id = ?1", params![id])?;
            tx.execute("DELETE FROM note_search WHERE id = ?1", params![id])?;
            tx.execute("DELETE FROM note_connections WHERE note_id = ?1", params![id])?;
            Ok(())
        })
    }

    /// Todas as linhas do índice, mais recentes primeiro, com suas conexões.
    pub fn list(&self) -> Result<Vec<NoteIndexRow>, DatabaseError> {
        self.database.with_connection(|connection| {
            let connections = load_connections(connection)?;
            let mut statement = connection.prepare(
                "SELECT id, file_name, title, folder, kind, template, status, plain_text, \
                 created_at, updated_at FROM note_index ORDER BY updated_at DESC",
            )?;
            // Liga a uma variável local para o `MappedRows` (que empresta
            // `statement`) ser dropado antes de `statement` no fim do bloco.
            let rows = statement
                .query_map([], |row| read_index_row(row, &connections))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    /// Ids das notas que casam com a busca, ordenados por relevância (FTS5 rank).
    /// Retorna vazio para consulta em branco.
    pub fn search(&self, query: &str) -> Result<Vec<String>, DatabaseError> {
        let match_query = fts_match_query(query);
        if match_query.is_empty() {
            return Ok(Vec::new());
        }
        self.database.with_connection(|connection| {
            let mut statement = connection
                .prepare("SELECT id FROM note_search WHERE note_search MATCH ?1 ORDER BY rank")?;
            let ids = statement
                .query_map(params![match_query], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        })
    }

    /// Reconstrói o índice inteiro a partir das linhas derivadas do vault.
    pub fn rebuild(&self, rows: &[NoteIndexRow]) -> Result<(), DatabaseError> {
        self.database.with_transaction(|tx| {
            tx.execute("DELETE FROM note_index", [])?;
            tx.execute("DELETE FROM note_search", [])?;
            tx.execute("DELETE FROM note_connections", [])?;
            for row in rows {
                write_metadata(tx, row)?;
                write_search(tx, row)?;
                write_connections(tx, row)?;
            }
            Ok(())
        })
    }

    /// Estado de retenção (revisão espaçada) como JSON, se já existir.
    pub fn get_retention(&self) -> Result<Option<String>, DatabaseError> {
        self.database.with_connection(|connection| {
            connection
                .query_row("SELECT state_json FROM note_retention WHERE id = 1", [], |row| {
                    row.get::<_, String>(0)
                })
                .optional()
        })
    }

    /// Grava (ou substitui) o estado de retenção.
    pub fn set_retention(&self, state_json: &str) -> Result<(), DatabaseError> {
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO note_retention (id, state_json) VALUES (1, ?1) \
                 ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json",
                params![state_json],
            )?;
            Ok(())
        })
    }
}

fn write_metadata(tx: &Transaction<'_>, row: &NoteIndexRow) -> Result<(), rusqlite::Error> {
    tx.execute(
        "INSERT INTO note_index (id, file_name, title, folder, kind, template, status, \
         plain_text, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) \
         ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name, title=excluded.title, \
         folder=excluded.folder, kind=excluded.kind, template=excluded.template, \
         status=excluded.status, plain_text=excluded.plain_text, \
         created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![
            row.id, row.file_name, row.title, row.folder, row.kind, row.template, row.status,
            row.plain_text, row.created_at, row.updated_at
        ],
    )?;
    Ok(())
}

fn write_search(tx: &Transaction<'_>, row: &NoteIndexRow) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM note_search WHERE id = ?1", params![row.id])?;
    tx.execute(
        "INSERT INTO note_search (id, title, plain_text) VALUES (?1,?2,?3)",
        params![row.id, row.title, row.plain_text],
    )?;
    Ok(())
}

fn write_connections(tx: &Transaction<'_>, row: &NoteIndexRow) -> Result<(), rusqlite::Error> {
    tx.execute("DELETE FROM note_connections WHERE note_id = ?1", params![row.id])?;
    for connection in &row.connections {
        tx.execute(
            "INSERT OR IGNORE INTO note_connections (note_id, target_id, reason) VALUES (?1,?2,?3)",
            params![row.id, connection.id, connection.reason],
        )?;
    }
    Ok(())
}

fn load_connections(
    connection: &Connection,
) -> Result<HashMap<String, Vec<IndexConnection>>, rusqlite::Error> {
    let mut statement =
        connection.prepare("SELECT note_id, target_id, reason FROM note_connections")?;
    let mut grouped: HashMap<String, Vec<IndexConnection>> = HashMap::new();
    let rows = statement.query_map([], |row| {
        let note_id: String = row.get(0)?;
        Ok((note_id, IndexConnection { id: row.get(1)?, reason: row.get(2)? }))
    })?;
    for entry in rows {
        let (note_id, connection) = entry?;
        grouped.entry(note_id).or_default().push(connection);
    }
    Ok(grouped)
}

fn read_index_row(
    row: &rusqlite::Row<'_>,
    connections: &HashMap<String, Vec<IndexConnection>>,
) -> Result<NoteIndexRow, rusqlite::Error> {
    let id: String = row.get(0)?;
    let owned = connections.get(&id).cloned().unwrap_or_default();
    Ok(NoteIndexRow {
        id,
        file_name: row.get(1)?,
        title: row.get(2)?,
        folder: row.get(3)?,
        kind: row.get(4)?,
        template: row.get(5)?,
        status: row.get(6)?,
        plain_text: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        connections: owned,
    })
}

/// Converte a busca do usuário em uma consulta FTS5 segura: cada palavra vira
/// um termo de prefixo (`palavra*`), sem deixar operadores do FTS vazarem.
fn fts_match_query(input: &str) -> String {
    input
        .split_whitespace()
        .map(|token| token.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|token| !token.is_empty())
        .map(|token| format!("{token}*"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, title: &str, plain_text: &str) -> NoteIndexRow {
        NoteIndexRow {
            id: id.to_owned(),
            file_name: format!("{id}.html"),
            title: title.to_owned(),
            folder: "inbox".to_owned(),
            kind: "fleeting".to_owned(),
            template: "blank".to_owned(),
            status: "saved".to_owned(),
            plain_text: plain_text.to_owned(),
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            updated_at: format!("2026-01-01T00:00:0{}.000Z", id.len()),
            connections: Vec::new(),
        }
    }

    fn index() -> SqliteNoteIndex {
        SqliteNoteIndex::new(Database::open_in_memory().expect("db"))
    }

    #[test]
    fn upsert_then_list_round_trips() {
        let index = index();
        let row = sample("a", "Ideia", "corpo da ideia");
        index.upsert(&row).unwrap();
        assert_eq!(index.list().unwrap(), vec![row]);
    }

    #[test]
    fn upsert_updates_existing_row() {
        let index = index();
        index.upsert(&sample("a", "v1", "texto um")).unwrap();
        index.upsert(&sample("a", "v2", "texto dois")).unwrap();
        let rows = index.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "v2");
    }

    #[test]
    fn search_matches_by_prefix_and_ignores_accents() {
        let index = index();
        index.upsert(&sample("a", "Café da manhã", "sobre cafeína")).unwrap();
        index.upsert(&sample("b", "Outra nota", "chá gelado")).unwrap();
        assert_eq!(index.search("cafe").unwrap(), vec!["a".to_owned()]);
        assert!(index.search("   ").unwrap().is_empty());
    }

    #[test]
    fn delete_removes_from_every_table() {
        let index = index();
        let mut row = sample("a", "Ideia", "corpo");
        row.connections.push(IndexConnection { id: "b".to_owned(), reason: "liga".to_owned() });
        index.upsert(&row).unwrap();
        index.delete("a").unwrap();
        assert!(index.list().unwrap().is_empty());
        assert!(index.search("ideia").unwrap().is_empty());
    }

    #[test]
    fn connections_survive_round_trip() {
        let index = index();
        let mut row = sample("a", "Ideia", "corpo");
        row.connections = vec![
            IndexConnection { id: "b".to_owned(), reason: "porque".to_owned() },
            IndexConnection { id: "c".to_owned(), reason: String::new() },
        ];
        index.upsert(&row).unwrap();
        let stored = index.list().unwrap().remove(0);
        assert_eq!(stored.connections.len(), 2);
        assert!(stored.connections.contains(&IndexConnection {
            id: "b".to_owned(),
            reason: "porque".to_owned()
        }));
    }

    #[test]
    fn rebuild_replaces_everything() {
        let index = index();
        index.upsert(&sample("old", "Antiga", "some")).unwrap();
        index.rebuild(&[sample("new", "Nova", "outra")]).unwrap();
        let rows = index.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "new");
    }

    #[test]
    fn retention_state_get_set() {
        let index = index();
        assert_eq!(index.get_retention().unwrap(), None);
        index.set_retention("{\"streak\":3}").unwrap();
        assert_eq!(index.get_retention().unwrap(), Some("{\"streak\":3}".to_owned()));
        index.set_retention("{\"streak\":4}").unwrap();
        assert_eq!(index.get_retention().unwrap(), Some("{\"streak\":4}".to_owned()));
    }
}
