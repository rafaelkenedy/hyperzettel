# ADR 0006 — Notes persisted as one self-contained HTML file per note

**Status:** Accepted · **Date:** 2026-07-24 · **Updated:** 2026-07-26 · **Supersedes:** the IndexedDB-as-source-of-truth model

## Context
Before this decision, a note's body was an HTML string kept in **IndexedDB** (`notes` store), images were WebP Blobs in a separate IndexedDB `images` store (referenced by `data-image-id`, no `src`), retention/knowledge state was in an IndexedDB `knowledge` store, and relations/embeddings lived in the native **SQLite** store. IndexedDB is a browser-local, opaque store that the OS/webview can clear; it is not a file the user owns.

A bible-agent analysis of the note structure (`audits/HTML-NOTES-EFFICIENCY-AGENTS.md`) found the design efficient for its scale but flagged: (a) **no ADR** recorded the "notes are HTML" decision (`architect`); (b) durability/portability is limited by the opaque store (`local-first-engineer`, ch 19 "the device owns the data"); (c) search re-derives plain text from HTML on every keystroke with no index (`data-engineer`/`qa`).

The owner has decided to move to **files on disk as the source of truth**, with **HTML** as the format and an **expanded tag set**.

## Decision
1. **One self-contained `.html` file per note**, stored in a **vault** folder on disk. The file is a complete HTML document (`<!doctype html>` + `<head>` + `<body>`).
2. **Images are embedded inline as base64 data URIs** (WebP), so each note is a single portable file. The IndexedDB `images` store and the `data-image-id` hydration path are removed.
3. **Metadata lives in `<meta>` tags** in `<head>`: `hz:id`, `hz:folder`, `hz:kind`, `hz:template`, `hz:status`, `hz:createdAt`, `hz:updatedAt`; **connections** as repeated `<meta name="hz:connection" content="<targetId>|<reason>">`.
4. **Body is the sanitized note HTML**, with the allowlist **expanded (minimal)**: add `TABLE, THEAD, TBODY, TR, TH, TD, CAPTION`, `H4, H5, H6`, `HR`. A minimal embedded `<style>` in the envelope gives standalone files reasonable rendering.
5. **Native SQLite becomes the mandatory operational store.** Note metadata,
   FTS over plain text, connections, the semantic mirror, embeddings, and
   automatic relations are projections rebuildable from the vault. Retention
   history and rejected-relation decisions are user state that is not derivable
   from the HTML files. **IndexedDB is removed** entirely.
6. **Writes are atomic** (temp file + rename) via Rust/Tauri fs commands, scoped to the vault folder with a path-traversal guard. Search is driven by SQLite FTS (not per-keystroke HTML parsing).
7. **The physical file name is presentation, not identity.** New notes use the readable convention `<UTC timestamp>--<title slug>--<short id>.html`, extending the ID segment on collision. Imported or manually renamed notes may use any safe `.html` name; `hz:id` is the internal identity.
8. **SQLite records a SHA-256 fingerprint** with each physical file name. Startup reconciliation compares `(file name, hash)`, so same-name external edits are detected. An indexed file renamed while the app is open is recovered by its hash.
9. **Ambiguous identity is never collapsed silently.** Files missing `hz:id` and every file participating in a duplicate `hz:id` are reported and excluded from the rebuilt index until corrected.

## Invariants

- `hz:id` inside the HTML is canonical; the file name never validates identity.
- One indexed file maps to one ID and one indexed ID maps to one file.
- Existing content is read, overwritten, adopted, or deleted only after the
  backend validates its internal ID and expected SHA-256.
- A conflicting external change fails closed: it is never overwritten or
  deleted silently.
- Files without an ID and all members of a duplicate-ID group stay outside the
  index until explicit resolution.
- Only bare `.html` names inside the vault are accepted; separators, `..`,
  symbolic links, and non-regular files are rejected.

## Write and recovery order

For a save, the backend validates the current identity and hash, writes and
synchronizes a unique temporary file, publishes it with `rename`, then updates
the SQLite projection. If the index update fails after the HTML was published,
the frontend rebuilds the projection and only reports success when the physical
document is exactly the intended document. A failed index update never
authorizes a second destructive filesystem mutation.

At startup and during explicit recovery, the app compares `(file name,
SHA-256)` fingerprints. It rebuilds note projections after additions, removals,
renames, or edits. This is reconciliation, not a continuous filesystem watcher;
an external edit during a long-running session may require reload/reopen.

| Lost or divergent state | Recovery | Residual loss |
| --- | --- | --- |
| Note metadata or FTS | Reparse the HTML vault | None |
| Embeddings or automatic relations | Rerun semantic indexing | Processing time |
| Queue checkpoint | Restart indexing | Intermediate progress |
| Retention history | Import an exported JSON backup | Reviews after the last backup |
| Rejected semantic relations | Import a v3 JSON backup | Decisions after the last backup |

The v3 JSON backup includes notes, retention history, and rejected semantic
relations. Earlier formats remain import-compatible and restore no rejection
state.

Security boundaries, abuse cases, and residual risks are maintained in the
[vault threat model](../security/vault-threat-model.md).

## Rationale
- **Data ownership & longevity (ch 19, local-first principle 1).** Real files the user can see, back up with rsync, version in git, sync with Syncthing, and open in any browser — durable beyond the app and not wiped by clearing browser data. Consistent with ADR 0004's stance that *transparent, durable access is a higher priority than confidentiality against local attackers* for a personal KB.
- **Self-contained HTML** matches the owner's intent ("exactly one html per note"): base64-inline images keep each file portable at the cost of size and image dedup — an accepted trade-off for a personal tool where cross-note image reuse is rare.
- **SQLite projections** remove the efficiency bottleneck the agents flagged
  (HTML re-parsed per keystroke) and give fast list/search/graph without reading
  every file. Calling the whole database “derived” would be inaccurate because
  retention and rejected-relation decisions also live there.
- **Minimal tag expansion** (tables/H4–H6/HR) covers the common gaps with a small, static, low-XSS surface the sanitizer already handles well (`security-engineer` approves).

## Consequences
- **More Rust/fs engineering:** vault commands (read/write/list/delete), atomic writes, capability scoping, path-traversal guards, and reindex-from-vault. IndexedDB's free transactional/indexed store is replaced by SQLite + files.
- **No migration.** There is no installed user base (single developer testing), so the legacy IndexedDB store and its migration path were removed; persistence is the vault from first run. The index reconciles from the vault on startup when it is empty (fresh device / synced vault / wiped index).
- **Bigger note files / no image dedup** from base64 inline; search indexing excludes base64 so query latency is unaffected.
- **`<meta>` for connections** is slightly awkward (repeated tags) but keeps everything in one file; the SQLite index is the queryable form.
- **External-write conflicts fail closed.** The application does not overwrite a file whose hash changed since it was indexed; the in-memory draft remains dirty and the user is told to reconcile the vault.
- **File names remain human-friendly but stable.** Renaming a title does not rename its file. Users may rename files manually because the convention is optional.
- **Backups remain necessary.** Deleting or corrupting SQLite does not lose note
  documents, but can lose retention history and rejected-relation decisions
  made after the most recent backup.
- **Atomic publication is not a full power-loss guarantee.** The implementation
  synchronizes the temporary file before `rename`, but does not explicitly
  synchronize the parent directory.
- **`document.execCommand`** remains for now; expanding tags increases the case for migrating off it later (tracked separately, not in this ADR).

## Revisit if
- Cross-note image reuse or very image-heavy notes make base64 bloat painful → move images to an `attachments/` folder with relative `src` (new ADR).
- **Sync/collaboration** enters scope → an opaque HTML string cannot merge; revisit the content representation (structured/CRDT doc) before building sync (`local-first-engineer`).
- The editor gains richer features → replace `document.execCommand` with a maintained editor core (Lexical/ProseMirror/TipTap) and re-verify sanitization on the new render path.
