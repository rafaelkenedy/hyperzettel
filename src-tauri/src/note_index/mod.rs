//! Persistência operacional em SQLite (ADR 0006): metadados, busca FTS5,
//! conexões e retenção. Os HTMLs são a fonte dos documentos; retenção não é
//! derivável deles e exige backup. O frontend fornece os campos derivados (já parseia o HTML);
//! este módulo apenas armazena e consulta.

mod sqlite_note_index;

pub use sqlite_note_index::{IndexConnection, NoteIndexRow, SqliteNoteIndex};
