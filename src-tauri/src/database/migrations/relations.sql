CREATE TABLE IF NOT EXISTS knowledge_notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    revision TEXT NOT NULL,
    folder TEXT NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_notes_active
    ON knowledge_notes(is_deleted, is_archived, updated_at);

CREATE TABLE IF NOT EXISTS note_embeddings (
    note_id TEXT PRIMARY KEY NOT NULL,
    vector BLOB NOT NULL,
    dimensions INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_variant TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    source_revision TEXT NOT NULL,
    truncated INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_embeddings_content_hash
    ON note_embeddings(content_hash);

CREATE INDEX IF NOT EXISTS idx_note_embeddings_pipeline_version
    ON note_embeddings(pipeline_version);

CREATE TABLE IF NOT EXISTS note_relations (
    id TEXT PRIMARY KEY NOT NULL,
    first_note_id TEXT NOT NULL,
    second_note_id TEXT NOT NULL,
    score REAL NOT NULL,
    origin TEXT NOT NULL,
    kind TEXT NOT NULL,
    model_id TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    first_revision TEXT NOT NULL,
    second_revision TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    CHECK(first_note_id < second_note_id),
    CHECK(origin IN ('automatic', 'manual')),
    CHECK(kind = 'semantic')
);

CREATE INDEX IF NOT EXISTS idx_note_relations_first
    ON note_relations(first_note_id);

CREATE INDEX IF NOT EXISTS idx_note_relations_second
    ON note_relations(second_note_id);

CREATE TABLE IF NOT EXISTS rejected_note_relations (
    id TEXT PRIMARY KEY NOT NULL,
    first_note_id TEXT NOT NULL,
    second_note_id TEXT NOT NULL,
    first_content_hash TEXT NOT NULL,
    second_content_hash TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    rejected_at TEXT NOT NULL,

    CHECK(first_note_id < second_note_id)
);

CREATE TABLE IF NOT EXISTS relation_indexing_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    pipeline_version TEXT NOT NULL,
    processed_count INTEGER NOT NULL,
    total_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    last_processed_note_id TEXT,
    updated_at TEXT NOT NULL
);

PRAGMA user_version = 1;
