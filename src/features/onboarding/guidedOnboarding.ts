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

export const FIRST_CYCLE_IDEA_TARGET = 3;

export type FirstCycleStage =
  | "capture"
  | "write"
  | "process"
  | "connect"
  | "expand"
  | "complete";

export interface FirstCycleProgress {
  stage: FirstCycleStage;
  structureId: string;
  captureId?: string;
  connectedCount: number;
  targetCount: number;
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
    showMap: notes.some((note) =>
      note.connections.some((connection) => connection.reason.trim().length > 0)
    ),
    showReview: notes.some((note) => note.status === "saved" && note.kind !== "fleeting")
  };
}

/**
 * O guia só acompanha vaults pequenos: depois de quatro notas o próprio
 * conteúdo já oferece contexto suficiente e o coach deixa de competir com o
 * trabalho real. O estágio é derivado das notas, nunca de um checklist salvo.
 */
export function firstCycleProgressFor(
  notes: readonly Note[],
  activeDraftId?: string
): FirstCycleProgress | null {
  if (notes.length > 6) return null;

  const structure = [...notes]
    .filter((note) => note.kind === "structure")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
  if (!structure) return null;

  const candidates = notes.filter((note) => note.id !== structure.id);
  if (!candidates.length) {
    return {
      stage: activeDraftId && activeDraftId !== structure.id ? "write" : "capture",
      structureId: structure.id,
      connectedCount: 0,
      targetCount: FIRST_CYCLE_IDEA_TARGET
    };
  }

  const connected = candidates.filter((note) => {
    const outgoing = note.connections.find((connection) => connection.id === structure.id);
    const incoming = structure.connections.find((connection) => connection.id === note.id);
    return (
      note.kind === "permanent" &&
      Boolean(outgoing?.reason.trim() || incoming?.reason.trim())
    );
  });
  if (connected.length >= FIRST_CYCLE_IDEA_TARGET) {
    return {
      stage: "complete",
      structureId: structure.id,
      captureId: connected[0]?.id,
      connectedCount: connected.length,
      targetCount: FIRST_CYCLE_IDEA_TARGET
    };
  }

  const connectedIds = new Set(connected.map((note) => note.id));
  const permanent = candidates.find(
    (note) => note.kind === "permanent" && !connectedIds.has(note.id)
  );
  if (permanent) {
    return {
      stage: "connect",
      structureId: structure.id,
      captureId: permanent.id,
      connectedCount: connected.length,
      targetCount: FIRST_CYCLE_IDEA_TARGET
    };
  }

  const unprocessed = candidates.find((note) => !connectedIds.has(note.id));
  if (unprocessed) {
    return {
      stage: "process",
      structureId: structure.id,
      captureId: unprocessed.id,
      connectedCount: connected.length,
      targetCount: FIRST_CYCLE_IDEA_TARGET
    };
  }

  if (activeDraftId && !notes.some((note) => note.id === activeDraftId)) {
    return {
      stage: "write",
      structureId: structure.id,
      connectedCount: connected.length,
      targetCount: FIRST_CYCLE_IDEA_TARGET
    };
  }

  return {
    stage: connected.length ? "expand" : "capture",
    structureId: structure.id,
    connectedCount: connected.length,
    targetCount: FIRST_CYCLE_IDEA_TARGET
  };
}
