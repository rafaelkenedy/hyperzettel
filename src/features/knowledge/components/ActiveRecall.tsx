/**
 * Sessão curta de recuperação ativa.
 *
 * A avaliação só aparece depois que a resposta é revelada. Assim uma revisão
 * mede a tentativa de reconstruir a ideia, não a familiaridade de relê-la.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, cn } from "@relume_io/relume-ui";
import { Eye, RotateCcw } from "lucide-react";

import { toPlainText } from "@/shared/html";
import { ReviewGrades } from "./ReviewGrades";

export function ActiveRecall({
  noteId,
  title,
  content,
  recallPrompt = "",
  onReviewed,
  compact = false
}: {
  noteId: string;
  title: string;
  content: string;
  recallPrompt?: string;
  onReviewed?: () => void;
  compact?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const answer = useMemo(() => toPlainText(content).trim(), [content]);
  const question =
    recallPrompt.trim() || `O que você consegue explicar sobre “${title || "esta ideia"}”?`;

  useEffect(() => {
    setRevealed(false);
  }, [noteId, content]);

  if (!revealed) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border-primary bg-background-primary",
          compact ? "p-2.5" : "p-3"
        )}
      >
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-hz-accent">
          Recupere sem olhar
        </p>
        <p className="mt-1 text-xs font-medium leading-snug">{question}</p>
        <p className="mt-1 text-2xs leading-relaxed text-text-secondary">
          Responda em voz alta, no papel ou mentalmente antes de conferir.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 h-8 gap-1.5 border-border-primary bg-background-secondary px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-hz-accent"
          onClick={() => setRevealed(true)}
        >
          <Eye className="size-3.5" strokeWidth={1.8} />
          Revelar nota
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-hz-accent/30 bg-background-primary",
        compact ? "p-2.5" : "p-3"
      )}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-hz-accent">
          Compare com sua resposta
        </p>
        <button
          type="button"
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-2xs text-text-secondary hover:bg-hz-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent"
          onClick={() => setRevealed(false)}
        >
          <RotateCcw className="size-3" strokeWidth={1.8} />
          Refazer
        </button>
      </div>

      <div className="hz-scroll mt-2 max-h-40 overflow-y-auto rounded-md bg-background-secondary p-2.5">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-primary">
          {answer || "Esta nota ainda não tem conteúdo além do título."}
        </p>
      </div>

      <p className="mb-1.5 mt-2.5 text-2xs font-medium leading-snug text-text-secondary">
        Quanto da ideia você reconstruiu antes de revelar?
      </p>
      <ReviewGrades
        noteId={noteId}
        onReviewed={() => {
          setRevealed(false);
          onReviewed?.();
        }}
      />
    </div>
  );
}
