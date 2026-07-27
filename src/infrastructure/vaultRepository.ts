/**
 * Repositório de notas sobre o vault: a fonte da verdade é um
 * arquivo `.html` por nota, e o SQLite é o índice derivado. É a única camada
 * de persistência de notas do app.
 *
 * Fronteira única de IPC para notas: mapeia `Note` <-> (documento HTML + linha
 * de índice) e fala com os comandos Rust `save_note`, `delete_note`,
 * `list_notes`, `read_note`, `search_notes`, `rebuild_note_index` e a
 * retenção. O Rust nunca interpreta HTML - os campos derivados saem daqui.
 */

import { invoke } from "@tauri-apps/api/core";

import { toPlainText } from "@/shared/html";
import {
  adoptHtmlDocumentAsNote,
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
  recallPrompt: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  connections: Connection[];
}

/** Documento cru do vault, usado só na reindexação/migração. */
export interface VaultDocument {
  fileName: string;
  html: string;
  contentHash: string;
}

export interface VaultFingerprint {
  fileName: string;
  contentHash: string;
}

export interface VaultIntegrityIssue {
  code: "missing_id" | "duplicate_id";
  fileNames: string[];
  id?: string;
}

export interface ReindexReport {
  indexed: number;
  issues: VaultIntegrityIssue[];
}

export interface VaultInfo {
  rootPath: string;
  fileCount: number;
  totalBytes: number;
}

export interface VaultInspection extends ReindexReport {
  rows: NoteIndexRow[];
}

/**
 * Deriva a linha de índice de uma nota. Notas novas usam um nome legível com
 * timestamp, título e id curto, mas uma reindexação deve fornecer o nome físico
 * encontrado no vault: a identidade vive em `hz:id`, não no nome do arquivo.
 */
export function toIndexRow(
  note: Note,
  fileName = noteFileName(note),
  contentHash = ""
): NoteIndexRow {
  return {
    id: note.id,
    fileName,
    title: note.title,
    folder: note.folder,
    kind: note.kind,
    template: note.template,
    status: note.status,
    plainText: toPlainText(note.content),
    recallPrompt: note.recallPrompt,
    contentHash,
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
  const load = async () => {
    const html = await invoke<string>("read_note", { id });
    const note = parseHtmlDocumentToNote(html);
    if (note && note.id !== id) {
      throw {
        code: "vault_identity_mismatch",
        message: `O arquivo da nota ${id} declara outro hz:id.`
      };
    }
    return note;
  };

  try {
    return await load();
  } catch (error) {
    if (!isExternalVaultChange(error)) throw error;
    const report = await reindexFromVault();
    if (report.issues.length) throw new VaultIntegrityError(report);
    return load();
  }
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
async function remove(id: string): Promise<void> {
  try {
    await invoke("delete_note", { id });
  } catch (error) {
    if (!isExternalVaultChange(error)) throw error;
    const report = await reindexFromVault();
    if (report.issues.length) throw new VaultIntegrityError(report);
    await invoke("delete_note", { id });
  }
}

/** Todos os documentos do vault - para reindexar ou migrar. */
function readAllDocuments(): Promise<VaultDocument[]> {
  return invoke<VaultDocument[]>("read_all_note_files");
}

/** Nomes físicos e hashes do vault, sem transferir o HTML pela fronteira IPC. */
function listFileNames(): Promise<VaultFingerprint[]> {
  return invoke<VaultFingerprint[]>("list_note_files");
}

function getInfo(): Promise<VaultInfo> {
  return invoke<VaultInfo>("get_vault_info");
}

function openFolder(): Promise<void> {
  return invoke("open_vault_folder");
}

/** Reconstrói o índice a partir das linhas derivadas pelo frontend. */
function rebuildIndex(rows: NoteIndexRow[]): Promise<void> {
  return invoke("rebuild_note_index", { rows });
}

/**
 * Reconstrói o índice a partir dos arquivos do vault (a fonte da verdade) e
 * retorna as notas indexadas e conflitos que exigem correção manual. Necessário
 * quando o índice não reflete os arquivos - ex.: vault sincronizado para outra
 * máquina, arquivo editado externamente ou índice apagado.
 */
export function inspectVaultDocuments(documents: VaultDocument[]): VaultInspection {
  const issues: VaultIntegrityIssue[] = [];
  const parsed = documents.flatMap((document) => {
    const note = parseHtmlDocumentToNote(document.html);
    if (!note) {
      issues.push({ code: "missing_id", fileNames: [document.fileName] });
      return [];
    }
    return [{ document, note }];
  });
  const byId = new Map<string, typeof parsed>();
  parsed.forEach((entry) => {
    const matches = byId.get(entry.note.id) ?? [];
    matches.push(entry);
    byId.set(entry.note.id, matches);
  });
  const duplicateIds = new Set<string>();
  byId.forEach((entries, id) => {
    if (entries.length < 2) return;
    duplicateIds.add(id);
    issues.push({
      code: "duplicate_id",
      id,
      fileNames: entries.map((entry) => entry.document.fileName)
    });
  });
  const rows = parsed
    .filter((entry) => !duplicateIds.has(entry.note.id))
    .map(({ document, note }) =>
      toIndexRow(note, document.fileName, document.contentHash)
    );
  return { indexed: rows.length, issues, rows };
}

async function inspectVault(): Promise<VaultInspection> {
  return inspectVaultDocuments(await readAllDocuments());
}

async function reindexFromVault(): Promise<ReindexReport> {
  const inspection = await inspectVault();
  const { rows, ...report } = inspection;
  await rebuildIndex(rows);
  return report;
}

/**
 * Adota um HTML externo sem identidade. O nome físico permanece igual; o
 * backend só publica o envelope do Hyperzettel se o SHA-256 ainda corresponder
 * à versão inspecionada.
 */
async function adoptDocument(fileName: string): Promise<Note> {
  const document = (await readAllDocuments()).find((item) => item.fileName === fileName);
  if (!document) {
    throw {
      code: "vault_file_missing",
      message: `O arquivo ${fileName} não está mais no vault.`
    };
  }

  const note = adoptHtmlDocumentAsNote(document.html);
  if (!note) {
    throw {
      code: "adopt_not_available",
      message: `O arquivo ${fileName} está vazio ou já possui uma identidade.`
    };
  }

  await invoke("adopt_note_file", {
    row: toIndexRow(note, fileName),
    expectedHash: document.contentHash,
    html: serializeNoteToHtmlDocument(note)
  });
  return note;
}

/**
 * Reconstrói o índice somente quando sua visão dos arquivos diverge do vault.
 * A comparação por nome + SHA-256 detecta notas criadas, removidas, renomeadas
 * ou editadas fora do app e repara índices antigos sem fingerprints.
 */
async function reconcileIndexWithVault(): Promise<ReindexReport | null> {
  const [rows, fingerprints] = await Promise.all([list(), listFileNames()]);
  const indexedNames = rows
    .map((row) => `${row.fileName}:${row.contentHash}`)
    .sort();
  const vaultNames = fingerprints
    .map((entry) => `${entry.fileName}:${entry.contentHash}`)
    .sort();
  const matches =
    indexedNames.length === vaultNames.length &&
    indexedNames.every((fileName, index) => fileName === vaultNames[index]);

  if (matches) return null;
  return reindexFromVault();
}

export class VaultIntegrityError extends Error {
  readonly report: ReindexReport;

  constructor(report: ReindexReport) {
    const names = report.issues.flatMap((issue) => issue.fileNames).slice(0, 3);
    super(
      `O vault contém ${report.issues.length} conflito(s) em ${names.join(", ")}. ` +
        "Corrija os arquivos indicados e reinicie a aplicação."
    );
    this.name = "VaultIntegrityError";
    this.report = report;
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function isExternalVaultChange(error: unknown): boolean {
  return [
    "vault_reindex_required",
    "vault_content_changed",
    "vault_file_missing",
    "vault_duplicate_content"
  ].includes(errorCode(error));
}

export function vaultErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof VaultIntegrityError) return error.message;
  switch (errorCode(error)) {
    case "vault_content_changed":
      return "O arquivo foi alterado fora do aplicativo. Seu rascunho foi preservado; copie-o e reinicie para reconciliar o vault.";
    case "vault_file_missing":
      return "O arquivo da nota foi movido ou removido. Seu rascunho foi preservado; reinicie para reconciliar o vault.";
    case "vault_duplicate_content":
    case "vault_identity_mismatch":
      return "Há um conflito de identidade entre arquivos do vault. Revise os arquivos antes de continuar.";
    case "adopt_id_exists":
    case "adopt_file_indexed":
    case "adopt_not_available":
      return "O arquivo não pode mais ser adotado nesse estado. Verifique o vault novamente.";
    default:
      return fallback;
  }
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
  listFileNames,
  getInfo,
  openFolder,
  inspectVault,
  adoptDocument,
  rebuildIndex,
  reindexFromVault,
  reconcileIndexWithVault,
  getRetention,
  setRetention
};

export type VaultRepository = typeof vaultRepository;
