import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Note } from "@/domain/notes";
import type {
  NoteRelation,
  RejectedRelation,
  RelationStatus
} from "@/features/knowledge/domain/relations";

export type RelationCommandError = {
  code: string;
  message: string;
  retryable: boolean;
};

const RELATION_EVENTS = [
  "knowledge-relations://model-loading",
  "knowledge-relations://model-ready",
  "knowledge-relations://indexing-progress",
  "knowledge-relations://note-indexed",
  "knowledge-relations://relations-updated",
  "knowledge-relations://indexing-paused",
  "knowledge-relations://indexing-completed",
  "knowledge-relations://error"
] as const;

function toKnowledgeNote(note: Note) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    tags: [],
    revision: note.updatedAt,
    folder: note.folder,
    isArchived: note.folder === "archive",
    isDeleted: false,
    updatedAt: note.updatedAt
  };
}

function logCommandFailure(operation: string, error: unknown): void {
  const safe = error as Partial<RelationCommandError> | null;
  console.error(
    `[knowledge-relations] ${operation}`,
    safe?.code ?? "COMMAND_FAILED",
    safe?.message ?? "Falha no comando nativo."
  );
}

export function nativeRelationsAvailable(): boolean {
  return isTauri();
}

export async function syncKnowledgeNotes(
  notes: readonly Note[],
  replaceMissing = false
): Promise<void> {
  if (!isTauri()) return;
  await invoke("sync_knowledge_notes", {
    notes: notes.map(toKnowledgeNote),
    replaceMissing
  });
}

export async function syncAndEnqueueNote(note: Note): Promise<void> {
  if (!isTauri()) return;
  if (note.folder === "archive") {
    await removeNoteFromKnowledgeIndex(note.id);
    return;
  }
  await syncKnowledgeNotes([note]);
  await invoke("enqueue_note_indexing", {
    noteId: note.id,
    revision: note.updatedAt
  });
}

export function enqueueNoteIndexing(note: Note): void {
  void syncAndEnqueueNote(note).catch((error) => logCommandFailure("enqueue", error));
}

export async function getRelatedNotes(noteId: string): Promise<NoteRelation[]> {
  if (!isTauri() || !noteId) return [];
  return invoke<NoteRelation[]>("get_related_notes", { noteId });
}

export async function getRelationStatus(): Promise<RelationStatus> {
  if (!isTauri()) return { type: "idle" };
  return invoke<RelationStatus>("get_relation_status");
}

export async function rebuildKnowledgeRelations(): Promise<void> {
  if (!isTauri()) return;
  await invoke("rebuild_knowledge_relations");
}

export async function pauseKnowledgeRelations(): Promise<void> {
  if (!isTauri()) return;
  await invoke("pause_relation_indexing");
}

export async function resumeKnowledgeRelations(): Promise<void> {
  if (!isTauri()) return;
  await invoke("resume_relation_indexing");
}

export async function rejectAutomaticRelation(relation: NoteRelation): Promise<void> {
  if (!isTauri()) return;
  await invoke("reject_automatic_relation", {
    firstNoteId: relation.firstNoteId,
    secondNoteId: relation.secondNoteId
  });
}

export async function restoreAutomaticRelation(relation: NoteRelation): Promise<void> {
  if (!isTauri()) return;
  await invoke("restore_automatic_relation", {
    firstNoteId: relation.firstNoteId,
    secondNoteId: relation.secondNoteId
  });
}

export async function exportRejectedRelations(): Promise<RejectedRelation[]> {
  if (!isTauri()) return [];
  return invoke<RejectedRelation[]>("export_rejected_relations");
}

export async function importRejectedRelations(
  rejectedRelations: readonly RejectedRelation[]
): Promise<number> {
  if (!isTauri() || rejectedRelations.length === 0) return 0;
  const result = await invoke<{ importedCount: number }>("import_rejected_relations", {
    rejectedRelations
  });
  return result.importedCount;
}

export async function removeNoteFromKnowledgeIndex(noteId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("remove_note_from_knowledge_index", { noteId });
}

export async function subscribeToRelationEvents(listener: () => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  const unlisten = await Promise.all(
    RELATION_EVENTS.map((eventName) => listen(eventName, listener))
  );
  return () => unlisten.forEach((stop) => stop());
}
