//! Índice derivado das notas em SQLite (ADR 0006): metadados, busca FTS5,
//! conexões e estado de retenção. Reconstruível a partir do vault, que é a
//! fonte da verdade. O frontend fornece os campos derivados (já parseia o HTML);
//! este módulo apenas armazena e consulta.

mod sqlite_note_index;

pub use sqlite_note_index::{IndexConnection, NoteIndexRow, SqliteNoteIndex};
