import type { NoteStatus } from "@/domain/notes";

export type NoteUiState =
  | "updating"
  | "autosave-pending"
  | "new-draft"
  | "draft-in-vault"
  | "ready";

interface NoteUiStateInput {
  saving: boolean;
  dirty: boolean;
  status: NoteStatus;
  hasPersistedNote: boolean;
}

interface CompletionActionInput {
  dirty: boolean;
  status: NoteStatus;
  hasPersistedNote: boolean;
  shortcut: string;
}

export interface CompletionAction {
  enabled: boolean;
  label: string;
}

/**
 * Estado que a interface comunica ao usuário.
 *
 * Persistência e maturidade são conceitos independentes: o autosave protege o
 * arquivo, enquanto "rascunho" indica que a ideia ainda não foi concluída.
 */
export function resolveNoteUiState({
  saving,
  dirty,
  status,
  hasPersistedNote
}: NoteUiStateInput): NoteUiState {
  if (saving) return "updating";
  if (dirty) return "autosave-pending";
  if (status === "draft") return hasPersistedNote ? "draft-in-vault" : "new-draft";
  return "ready";
}

export function resolveCompletionAction({
  dirty,
  status,
  hasPersistedNote,
  shortcut
}: CompletionActionInput): CompletionAction {
  if (status === "draft") {
    return dirty || hasPersistedNote
      ? { enabled: true, label: `Concluir nota (${shortcut})` }
      : { enabled: false, label: "Escreva antes de concluir" };
  }

  return dirty
    ? { enabled: true, label: `Aplicar alterações agora (${shortcut})` }
    : { enabled: false, label: "Nota pronta" };
}

export const NOTE_UI_LABELS: Record<NoteUiState, string> = {
  updating: "Atualizando arquivo…",
  "autosave-pending": "Autosave pendente",
  "new-draft": "Novo rascunho",
  "draft-in-vault": "Rascunho no vault",
  ready: "Nota pronta"
};
