/**
 * As quatro respostas de uma revisão.
 *
 * Cada botão mostra o intervalo que aquela resposta agenda. Ver o custo antes
 * de responder é o que evita o viés de marcar tudo como "lembrei bem": a
 * escolha passa a ter consequência visível.
 */

import { Button, cn } from "@relume_io/relume-ui";

import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { QUALITY_LABELS, REVIEW_QUALITIES, type Quality } from "../model/scheduler";
import { formatInterval } from "../lib/format";

const TONE: Record<number, string> = {
  1: "hover:border-[#a3324c]/40 hover:bg-[#fdeef1]",
  3: "hover:border-[#8a5a12]/40 hover:bg-[#fdf1dd]",
  4: "hover:border-hz-accent/40 hover:bg-[#e9edfa]",
  5: "hover:border-[#1c6b45]/40 hover:bg-[#e8f4ec]"
};

export function ReviewGrades({
  noteId,
  onReviewed,
  compact = false
}: {
  noteId: string;
  onReviewed?: () => void;
  compact?: boolean;
}) {
  const knowledge = useKnowledge();
  const preview = knowledge.previewIntervals(noteId);
  const state = knowledge.snapshot.notes.find((note) => note.id === noteId);

  /*
   * No SM-2 as duas primeiras repetições têm prazo fixo (1 e 6 dias). Repetir
   * o mesmo número embaixo dos quatro botões fazia a tela parecer quebrada e
   * exigia um parágrafo para se explicar — então o prazo sai de dentro dos
   * botões e vira uma linha só. A resposta continua importando: ela ajusta a
   * facilidade da nota, que alonga os intervalos a partir da terceira revisão.
   */
  const intervals = REVIEW_QUALITIES.map((quality) => preview[quality]);
  const sameInterval = intervals.every((value) => value === intervals[0]);
  const fixedLadder = (state?.repetitions ?? 0) < 2;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("grid gap-1", compact ? "grid-cols-4" : "grid-cols-2")}>
      {REVIEW_QUALITIES.map((quality: Quality) => (
        <Button
          key={quality}
          variant="secondary"
          size="sm"
          title={QUALITY_LABELS[quality].hint}
          onClick={async () => {
            await knowledge.reviewNote(noteId, quality);
            onReviewed?.();
          }}
          className={cn(
            "min-h-8 flex-col items-start gap-0 border-border-primary bg-background-primary px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-hz-accent",
            TONE[quality]
          )}
        >
          <span className="text-xs font-medium leading-tight">
            {QUALITY_LABELS[quality].label}
          </span>
          {sameInterval ? null : (
            <span className="text-2xs leading-tight text-text-secondary">
              {preview[quality] !== undefined ? formatInterval(preview[quality]) : "—"}
            </span>
          )}
        </Button>
        ))}
      </div>

      {sameInterval && intervals[0] !== undefined ? (
        <p className="text-2xs leading-snug text-text-secondary">
          {fixedLadder ? "Prazo fixo desta etapa: " : "Próxima em "}
          <strong className="font-medium">{formatInterval(intervals[0])}</strong>
          {fixedLadder ? ". Sua resposta ajusta a facilidade da nota." : "."}
        </p>
      ) : null}
    </div>
  );
}
