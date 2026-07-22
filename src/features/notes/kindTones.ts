import type { NoteKind } from "@/domain/notes";

/** Tokens compartilhados por todos os lugares que apresentam o estágio. */
export const KIND_TONE_CLASSES: Record<NoteKind, string> = {
  fleeting:
    "bg-hz-kind-fleeting text-hz-kind-fleeting-ink ring-hz-kind-fleeting-ring",
  source: "bg-hz-kind-source text-hz-kind-source-ink ring-hz-kind-source-ring",
  permanent:
    "bg-hz-kind-permanent text-hz-kind-permanent-ink ring-hz-kind-permanent-ring",
  structure:
    "bg-hz-kind-structure text-hz-kind-structure-ink ring-hz-kind-structure-ring",
  reference:
    "bg-hz-kind-reference text-hz-kind-reference-ink ring-hz-kind-reference-ring"
};
