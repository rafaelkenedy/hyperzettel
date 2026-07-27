/**
 * Fila de revisão, ordenada por vencimento.
 *
 * O SM-2 agenda *quando* revisar, então uma nota atrasada tem prioridade
 * mesmo que a estimativa dela ainda esteja alta. Quem nunca foi revisada
 * entra pela estimativa, já que não tem data.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, cn } from "@relume_io/relume-ui";
import { CircleCheckBig } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { LEVEL_TONE, dueSummary, percent } from "../lib/format";
import {
  isReviewDue,
  isReviewEligible,
  type GraphNote
} from "../model/knowledgeModel";
import { ActiveRecall } from "./ActiveRecall";

const QUEUE_SIZE = 25;
const YEAR = 365 * 86_400_000;

export function ReviewQueue({
  selectedId,
  onFocus,
  requestedId = null,
  onRequestConsumed
}: {
  selectedId: string | null;
  onFocus: (id: string | null) => void;
  requestedId?: string | null;
  onRequestConsumed?: () => void;
}) {
  const notes = useNotes();
  const knowledge = useKnowledge();
  const savedById = useMemo(
    () => new Map(notes.savedNotes.map((note) => [note.id, note])),
    [notes.savedNotes]
  );

  const dueCandidates = useMemo(() => {
    const now = Date.parse(knowledge.snapshot.at);
    const dueScore = (note: GraphNote) =>
      note.dueAt ? Date.parse(note.dueAt) : now + note.strength * YEAR;

    return [...knowledge.snapshot.notes]
      .filter((note) => isReviewDue(note, now))
      .sort(
        (left, right) =>
          dueScore(left) - dueScore(right) || left.title.localeCompare(right.title, "pt-BR")
      )
      .slice(0, QUEUE_SIZE);
  }, [knowledge.snapshot.at, knowledge.snapshot.notes]);
  const requestedCandidate = requestedId
    ? knowledge.snapshot.notes.find(
        (note) => note.id === requestedId && isReviewEligible(note)
      )
    : undefined;

  /*
   * A sessão captura a fila vencida ao abrir. Assim avaliar uma nota não faz a
   * próxima posição ser preenchida por outra e o usuário tem um fim alcançável.
   */
  const [sessionIds, setSessionIds] = useState<string[]>(() =>
    requestedCandidate
      ? [requestedCandidate.id]
      : dueCandidates.map((note) => note.id)
  );
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [sessionMode, setSessionMode] = useState<"due" | "targeted">(
    requestedCandidate ? "targeted" : "due"
  );

  /*
   * O editor expressa uma intenção diferente da fila automática: revisar esta
   * nota agora. A sessão avulsa contém somente o alvo e não altera a regra de
   * vencimento usada pela fila normal.
   */
  useEffect(() => {
    if (!requestedId) return;

    const requested = knowledge.snapshot.notes.find(
      (note) => note.id === requestedId && isReviewEligible(note)
    );
    if (requested) {
      setSessionIds([requested.id]);
      setReviewedIds(new Set());
      setSessionMode("targeted");
      onFocus(requested.id);
    }
    onRequestConsumed?.();
  }, [knowledge.snapshot.notes, onFocus, onRequestConsumed, requestedId]);

  useEffect(() => {
    if (!sessionIds.length && !reviewedIds.size && dueCandidates.length) {
      setSessionIds(dueCandidates.map((note) => note.id));
    }
  }, [dueCandidates, reviewedIds.size, sessionIds.length]);

  const queue = useMemo(() => {
    const snapshotById = new Map(
      knowledge.snapshot.notes.map((note) => [note.id, note])
    );
    return sessionIds
      .map((id) => snapshotById.get(id))
      .filter(
        (note): note is GraphNote =>
          note !== undefined && !reviewedIds.has(note.id)
      );
  }, [knowledge.snapshot.notes, reviewedIds, sessionIds]);

  const total = sessionIds.length;
  const completed = sessionIds.filter((id) => reviewedIds.has(id)).length;

  useEffect(() => {
    if (queue.length && !queue.some((note) => note.id === selectedId)) {
      onFocus(queue[0]!.id);
    } else if (!queue.length && selectedId && sessionIds.includes(selectedId)) {
      onFocus(null);
    }
  }, [onFocus, queue, selectedId, sessionIds]);

  function completeReview(id: string) {
    const next = queue.find((note) => note.id !== id);
    setReviewedIds((current) => new Set(current).add(id));
    onFocus(next?.id ?? null);
  }

  if (!queue.length) {
    const hasReviewableNotes = knowledge.snapshot.notes.some(isReviewEligible);

    return (
      <div className="py-10 text-center">
        {completed ? (
          <>
            <CircleCheckBig
              className="mx-auto size-8 text-hz-accent"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <p className="mt-2 text-sm font-semibold">Sessão concluída</p>
            <p className="mt-1 text-xs text-text-secondary">
              {completed} {completed === 1 ? "nota revisada" : "notas revisadas"}.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">
              {hasReviewableNotes ? "Tudo em dia" : "Sua fila está vazia"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {hasReviewableNotes
                ? "Nenhuma revisão está vencida agora."
                : "Conclua uma nota permanente para iniciar as revisões."}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mb-3" role="status" aria-live="polite">
        <div className="mb-1.5 flex items-center justify-between text-2xs text-text-secondary">
          <span>
            {completed} de {total} {total === 1 ? "concluída" : "concluídas"}
          </span>
          <span>{queue.length} {queue.length === 1 ? "restante" : "restantes"}</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-background-secondary"
          role="progressbar"
          aria-label="Progresso da sessão de revisão"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <div
            className="h-full rounded-full bg-hz-accent transition-[width]"
            style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <p className="mb-2 text-2xs leading-relaxed text-text-secondary">
        {sessionMode === "targeted"
          ? "Revisão escolhida. Tente explicar a ideia e só então revele a resposta."
          : "Vencidas primeiro. Tente explicar a ideia e só então revele a resposta."}
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
                    content={savedById.get(note.id)?.content ?? ""}
                    recallPrompt={savedById.get(note.id)?.recallPrompt ?? ""}
                    onReviewed={() => completeReview(note.id)}
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
