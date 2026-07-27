/**
 * Fila de revisão, ordenada por vencimento.
 *
 * O SM-2 agenda *quando* revisar, então uma nota atrasada tem prioridade
 * mesmo que a estimativa dela ainda esteja alta. Quem nunca foi revisada
 * entra pela estimativa, já que não tem data.
 */

import { useMemo } from "react";
import { Button, cn } from "@relume_io/relume-ui";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { LEVEL_TONE, dueSummary, percent } from "../lib/format";
import type { GraphNote } from "../model/knowledgeModel";
import { ActiveRecall } from "./ActiveRecall";

const QUEUE_SIZE = 25;
const YEAR = 365 * 86_400_000;

export function ReviewQueue({
  selectedId,
  onFocus
}: {
  selectedId: string | null;
  onFocus: (id: string) => void;
}) {
  const notes = useNotes();
  const knowledge = useKnowledge();

  const queue = useMemo(() => {
    const now = Date.now();
    const dueScore = (note: GraphNote) =>
      note.dueAt ? Date.parse(note.dueAt) : now + note.strength * YEAR;

    return [...knowledge.snapshot.notes]
      .filter((note) => note.status === "saved" && note.kind !== "fleeting")
      .sort(
        (left, right) =>
          dueScore(left) - dueScore(right) || left.title.localeCompare(right.title, "pt-BR")
      )
      .slice(0, QUEUE_SIZE);
  }, [knowledge.snapshot.notes]);

  if (!queue.length) {
    return (
      <p className="py-10 text-center text-xs text-text-secondary">
        Crie notas para formar uma fila de revisão.
      </p>
    );
  }

  return (
    <>
      <p className="mb-2 text-2xs leading-relaxed text-text-secondary">
        Vencidas primeiro. Selecione uma nota, tente explicá-la e só então revele a
        resposta.
      </p>

      <ul className="flex flex-col gap-1">
        {queue.map((note) => (
          <li key={note.id}>
            <div
              className={cn(
                "rounded-lg border p-2.5 transition-colors",
                note.id === selectedId
                  ? "border-hz-accent/40 bg-[#e9edfa]"
                  : "border-border-secondary hover:bg-background-secondary"
              )}
            >
              <button
                type="button"
                onClick={() => onFocus(note.id)}
                className="w-full text-left"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-2xs font-semibold tabular-nums",
                      LEVEL_TONE[note.level]
                    )}
                  >
                    {percent(note.strength)}
                  </span>
                  <span className="truncate text-2xs text-text-secondary">
                    {dueSummary(note.dueAt)} · {note.reviewCount} rev.
                  </span>
                </span>
                <span className="mt-1 block text-xs font-medium leading-snug">{note.title}</span>
              </button>

              {note.id === selectedId ? (
                <div className="mt-2">
                  <ActiveRecall
                    noteId={note.id}
                    title={note.title}
                    content={
                      notes.savedNotes.find((candidate) => candidate.id === note.id)?.content ?? ""
                    }
                    compact
                  />
                </div>
              ) : null}

              <div className="mt-1.5 flex items-center gap-1">
                <Button
                  variant="link"
                  size="sm"
                  className="h-6 gap-1 px-0 text-2xs text-hz-accent"
                  onClick={() => void notes.openNote(note.id)}
                >
                  Abrir nota
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
