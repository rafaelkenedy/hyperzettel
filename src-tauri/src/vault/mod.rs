//! Persistência das notas como arquivos `.html` auto-contidos.
//!
//! O `VaultStore` é a única fronteira de filesystem para notas: valida caminhos
//! contra a raiz do vault e grava de forma atômica. O SQLite é o índice
//! derivado; estes arquivos são a fonte da verdade.

mod note_file_store;

pub use note_file_store::{VaultError, VaultStore};
