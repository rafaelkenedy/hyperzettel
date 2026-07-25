/**
 * Barra de estado inferior. Mostra apenas informação real do workspace:
 * escopo atual, total de notas, estado do rascunho e atalhos.
 */

import { CircleCheck, Database, Loader2, PenLine } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { scopeLabel } from "@/domain/notes";
import { formatRelative } from "@/shared/html";
import { formatShortcut } from "@/shared/platform";

function SaveIndicator() {
  const notes = useNotes();
  const isDraft = notes.draft.status === "draft";

  if (notes.saving) {
    return (
      <span className="flex items-center gap-1.5 text-text-secondary">
        <Loader2 className="size-3 animate-spin" strokeWidth={2} />
        Salvando…
      </span>
    );
  }
  if (notes.dirty) {
    return (
      <span className="flex items-center gap-1.5 text-hz-draft">
        <PenLine className="size-3" strokeWidth={2} />
        {isDraft ? "Rascunho · alterações pendentes" : "Alterações não salvas"}
      </span>
    );
  }
  if (isDraft) {
    return (
      <span className="flex items-center gap-1.5 text-hz-draft">
        <PenLine className="size-3" strokeWidth={2} />
        {notes.currentNote ? "Rascunho salvo localmente" : "Novo rascunho"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-text-secondary">
      <CircleCheck className="size-3" strokeWidth={2} />
      {notes.currentNote
        ? `Salva ${formatRelative(notes.currentNote.updatedAt)}`
        : "Nada a salvar"}
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
          {formatShortcut("Shift+K")} conectar · {formatShortcut("S")} salvar
        </span>
      </div>
    </footer>
  );
}
