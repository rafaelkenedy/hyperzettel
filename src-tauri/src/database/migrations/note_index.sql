-- Índice derivado das notas. A fonte da verdade é o vault de
-- arquivos `.html`; estas tabelas são reconstruíveis a partir dele e existem
-- para listar/buscar sem ler o corpo pesado (com base64) de cada arquivo.

CREATE TABLE IF NOT EXISTS note_index (
    id TEXT PRIMARY KEY NOT NULL,
    file_name TEXT NOT NULL,
    title TEXT NOT NULL,
    folder TEXT NOT NULL,
    kind TEXT NOT NULL,
    template TEXT NOT NULL,
    status TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    recall_prompt TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_index_updated_at
    ON note_index(updated_at);

CREATE INDEX IF NOT EXISTS idx_note_index_folder
    ON note_index(folder);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_index_file_name
    ON note_index(file_name);

-- Conexões declaradas pelo usuário (distintas das relações semânticas do
-- módulo knowledge): aresta simples nota -> alvo, com o motivo.
CREATE TABLE IF NOT EXISTS note_connections (
    note_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (note_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_note_connections_target
    ON note_connections(target_id);

-- Busca full-text sobre título + texto puro (o base64 das imagens nunca entra
-- aqui, porque o plainText é derivado com as tags removidas).
CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(
    id UNINDEXED,
    title,
    plain_text,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Estado de retenção (revisão espaçada), migrado do IndexedDB. Documento único.
CREATE TABLE IF NOT EXISTS note_retention (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    state_json TEXT NOT NULL
);

PRAGMA user_version = 4;
