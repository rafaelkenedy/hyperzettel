import { KIND_LABELS, type Note, type NoteKind } from "@/domain/notes";

const MAX_SUBJECT_LENGTH = 120;

export interface GuidedTopicDraft {
  title: string;
  content: string;
  folder: Note["folder"];
  kind: Note["kind"];
  template: Note["template"];
}

export interface ProgressiveNavigation {
  folderIds: Note["folder"][];
  kindIds: NoteKind[];
  showProcess: boolean;
  showMap: boolean;
  showReview: boolean;
}

export function normalizeGuidedSubject(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_SUBJECT_LENGTH);
}

export function createGuidedTopicDraft(subject: string): GuidedTopicDraft {
  const title = normalizeGuidedSubject(subject);
  if (title.length < 3) {
    throw new Error("Informe um assunto com pelo menos três caracteres.");
  }

  return {
    title,
    folder: "resources",
    kind: "structure",
    template: "blank",
    content:
      "<h2>O que quero compreender</h2>" +
      "<p>Explique em uma frase qual resultado tornaria este estudo útil para você.</p>" +
      "<h2>Perguntas que guiam</h2>" +
      "<ul><li>O que eu já sei sobre este assunto?</li>" +
      "<li>O que ainda preciso descobrir ou testar?</li></ul>" +
      "<h2>Próxima nota</h2>" +
      "<p>Capture uma ideia pequena que responda a uma das perguntas. Depois, conecte-a de volta a este mapa e registre o motivo.</p>"
  };
}

export function progressiveNavigationFor(notes: readonly Note[]): ProgressiveNavigation {
  const folderIds = [...new Set(notes.map((note) => note.folder))]
    .filter((folder) => folder !== "inbox" && folder !== "archive")
    .sort();
  const kindIds = (Object.keys(KIND_LABELS) as NoteKind[]).filter((kind) =>
    notes.some((note) => note.kind === kind)
  );

  return {
    folderIds,
    kindIds,
    showProcess: notes.some((note) => note.folder === "inbox" || note.kind === "fleeting"),
    showMap: notes.some((note) => note.connections.length > 0),
    showReview: notes.some((note) => note.status === "saved" && note.kind !== "fleeting")
  };
}
