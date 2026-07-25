/**
 * Repositório de notas sobre o vault: a fonte da verdade é um
 * arquivo `.html` por nota, e o SQLite é o índice derivado. É a única camada
 * de persistência de notas do app.
 *
 * Fronteira única de IPC para notas: mapeia `Note` <-> (documento HTML + linha
 * de índice) e fala com os comandos Rust `save_note`, `delete_note`,
 * `list_notes`, `read_note_file`, `search_notes`, `rebuild_note_index` e a
 * retenção. O Rust nunca interpreta HTML — os campos derivados saem daqui.
 */

import { invoke } from "@tauri-apps/api/core";

import { toPlainText } from "@/shared/html";
import {
  noteFileName,
  parseHtmlDocumentToNote,
  serializeNoteToHtmlDocument
} from "@/shared/noteDocument";
import type { Connection, Note } from "@/domain/notes";

/** Linha leve do índice (metadados + texto puro + conexões), sem o HTML pesado. */
export interface NoteIndexRow {
  id: string;
  fileName: string;
  title: string;
  folder: string;
  kind: string;
  template: string;
  status: string;
  plainText: string;
  createdAt: string;
  updatedAt: string;
  connections: Connection[];
}

/** Documento cru do vault, usado só na reindexação/migração. */
export interface VaultDocument {
  fileName: string;
  html: string;
}

/** Deriva a linha de índice de uma nota — o plainText já descarta o base64. */
export function toIndexRow(note: Note): NoteIndexRow {
  return {
    id: note.id,
    fileName: noteFileName(note),
    title: note.title,
    folder: note.folder,
    kind: note.kind,
    template: note.template,
    status: note.status,
    plainText: toPlainText(note.content),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    connections: note.connections
  };
}

/** Linhas do índice, mais recentes primeiro, sem ler o corpo dos arquivos. */
function list(): Promise<NoteIndexRow[]> {
  return invoke<NoteIndexRow[]>("list_notes");
}

/** Ids que casam com a busca, por relevância (FTS5). Vazio para consulta vazia. */
function search(query: string): Promise<string[]> {
  return invoke<string[]>("search_notes", { query });
}

/** Lê e parseia a nota completa sob demanda (ao abri-la). */
async function read(id: string): Promise<Note | null> {
  const html = await invoke<string>("read_note_file", { fileName: noteFileName({ id }) });
  return parseHtmlDocumentToNote(html);
}

/** Serializa a nota para HTML e grava arquivo + índice numa operação. */
function save(note: Note): Promise<void> {
  return invoke("save_note", { row: toIndexRow(note), html: serializeNoteToHtmlDocument(note) });
}

/** Grava várias notas (usado ao dividir uma nota em seções). */
async function saveMany(notes: Note[]): Promise<void> {
  for (const note of notes) {
    await save(note);
  }
}

/** Remove a nota do vault e do índice. */
function remove(id: string): Promise<void> {
  return invoke("delete_note", { id, fileName: noteFileName({ id }) });
}

/** Todos os documentos do vault — para reindexar ou migrar. */
function readAllDocuments(): Promise<VaultDocument[]> {
  return invoke<VaultDocument[]>("read_all_note_files");
}

/** Reconstrói o índice a partir das linhas derivadas pelo frontend. */
function rebuildIndex(rows: NoteIndexRow[]): Promise<void> {
  return invoke("rebuild_note_index", { rows });
}

/**
 * Reconstrói o índice a partir dos arquivos do vault (a fonte da verdade) e
 * retorna quantas notas foram indexadas. Necessário quando o índice não reflete
 * os arquivos — ex.: vault sincronizado para outra máquina ou índice apagado.
 */
async function reindexFromVault(): Promise<number> {
  const documents = await readAllDocuments();
  const rows = documents
    .map((document) => parseHtmlDocumentToNote(document.html))
    .filter((note): note is Note => note !== null)
    .map(toIndexRow);
  await rebuildIndex(rows);
  return rows.length;
}

/** Estado de retenção (revisão espaçada) desserializado, ou `null`. */
async function getRetention(): Promise<unknown | null> {
  const json = await invoke<string | null>("get_retention_state");
  return json ? JSON.parse(json) : null;
}

function setRetention(state: unknown): Promise<void> {
  return invoke("set_retention_state", { stateJson: JSON.stringify(state) });
}

export const vaultRepository = {
  list,
  search,
  read,
  save,
  saveMany,
  remove,
  readAllDocuments,
  rebuildIndex,
  reindexFromVault,
  getRetention,
  setRetention
};

export type VaultRepository = typeof vaultRepository;
