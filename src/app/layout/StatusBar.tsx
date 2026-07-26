/**
 * Barra de estado inferior. Mostra apenas informação real do workspace:
 * escopo atual, total de notas, estado do arquivo e atalhos.
 */

import { CircleCheck, Database, Loader2, PenLine } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { scopeLabel } from "@/domain/notes";
import { formatRelative } from "@/shared/html";
import { formatShortcut } from "@/shared/platform";
import { NOTE_UI_LABELS, resolveNoteUiState } from "@/features/notes/noteUiState";

function SaveIndicator() {
  const notes = useNotes();
  const state = resolveNoteUiState({
    saving: notes.saving,
    dirty: notes.dirty,
    status: notes.draft.status,
    hasPersistedNote: notes.currentNote !== null
  });

  if (state === "updating") {
    return (
      <span className="flex items-center gap-1.5 text-text-secondary">
        <Loader2 className="size-3 animate-spin" strokeWidth={2} />
        {NOTE_UI_LABELS[state]}
      </span>
    );
  }
  if (state === "autosave-pending") {
    return (
      <span className="flex items-center gap-1.5 text-hz-draft">
        <PenLine className="size-3" strokeWidth={2} />
        {NOTE_UI_LABELS[state]}
      </span>
    );
  }
  if (state === "new-draft" || state === "draft-in-vault") {
    return (
      <span className="flex items-center gap-1.5 text-hz-draft">
        <PenLine className="size-3" strokeWidth={2} />
        {NOTE_UI_LABELS[state]}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-text-secondary">
      <CircleCheck className="size-3" strokeWidth={2} />
      {notes.currentNote
        ? `Nota pronta · atualizada ${formatRelative(notes.currentNote.updatedAt)}`
        : NOTE_UI_LABELS[state]}
    </span>
  );
}

export function StatusBar() {
  const notes = useNotes();

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border-primary bg-hz-rail px-3 text-xs text-text-secondary">
      <span className="flex items-center gap-1.5">
        <Database className="size-3" strokeWidth={1.75} />
        hyperzettel · vault local
      </span>

      <span className="text-border-tertiary">|</span>
      <span>{scopeLabel(notes.scope)}</span>

      <span className="text-border-tertiary">|</span>
      <span className="tabular-nums">
        {notes.notes.length} {notes.notes.length === 1 ? "nota" : "notas"}
      </span>

      <div className="ml-auto flex items-center gap-3">
        <SaveIndicator />
        <span className="text-border-tertiary">|</span>
        <span className="hidden lg:inline">
          {formatShortcut("N")} nova · {formatShortcut("K")} buscar ·{" "}
          {formatShortcut("Shift+K")} conectar · {formatShortcut("S")} concluir
        </span>
      </div>
    </footer>
  );
}
