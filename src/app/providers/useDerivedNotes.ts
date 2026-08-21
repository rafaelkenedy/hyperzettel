/**
 * Dados derivados da coleção de notas.
 *
 * Concentra os `useMemo` que calculam contagens, relações, fila de
 * processamento e lista visível. Extraído do NotesProvider para que ele
 * fique abaixo de 500 linhas e cada módulo cuide de uma coisa só.
 */

import { useMemo } from "react";

import {
  countByFolder,
  countByKind,
  createConnectionCounts,
  filterAndSort,
  findRelations,
  hasMeaningfulContent,
  mergeNote,
  type Note,
  type Relation,
  type Scope
} from "@/domain/notes";
import { toPlainText } from "@/shared/html";

export interface DerivedNotes {
  /** A coleção com o rascunho mesclado, para a lista refletir a digitação. */
  notesWithDraft: Note[];
  visibleNotes: Note[];
  processQueue: Note[];
  connectionCounts: Map<string, number>;
  /** Notas relacionadas, uma vez cada, com a direção marcada. */
  relations: Relation[];
  folderCounts: Record<string, number>;
  kindCounts: Record<string, number>;
}

export function useDerivedNotes(
  notes: Note[],
  draft: Note,
  currentNote: Note | null,
  scope: Scope,
  query: string
): DerivedNotes {
  /**
   * A lista precisa mostrar o rascunho em edição junto das notas gravadas,
   * para que título e pasta reflitam a digitação em tempo real.
   */
  const notesWithDraft = useMemo(() => {
    const meaningful = hasMeaningfulContent(
      { title: draft.title, content: draft.content, connections: draft.connections },
      toPlainText
    );
    if (!currentNote && !meaningful) return notes;
    return mergeNote(notes, draft);
  }, [notes, draft, currentNote]);

  const visibleNotes = useMemo(
    () => filterAndSort(notesWithDraft, { scope, query, toPlainText }),
    [notesWithDraft, scope, query]
  );

  const connectionCounts = useMemo(
    () => createConnectionCounts(notesWithDraft),
    [notesWithDraft]
  );

  const relations = useMemo(
    () => findRelations(notesWithDraft, draft.id),
    [notesWithDraft, draft.id]
  );

  const folderCounts = useMemo(() => countByFolder(notesWithDraft), [notesWithDraft]);
  const kindCounts = useMemo(() => countByKind(notesWithDraft), [notesWithDraft]);

  /*
   * A fila é o que está na entrada mais o que já saiu dela mas continua
   * fugaz — o fluxo do Zettelkasten processa ideias cruas, não pastas.
   */
  const processQueue = useMemo(
    () =>
      notes
        .filter((note) => note.folder === "inbox" || note.kind === "fleeting")
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
    [notes]
  );

  return {
    notesWithDraft,
    visibleNotes,
    processQueue,
    connectionCounts,
    relations,
    folderCounts,
    kindCounts
  };
}
