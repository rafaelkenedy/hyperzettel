import { AlertCircle, Check, LoaderCircle, Pause } from "lucide-react";

import { useKnowledgeRelations } from "./KnowledgeRelationsProvider";

export function RelationStatus() {
  const { status } = useKnowledgeRelations();
  if (status.type === "idle") return null;

  const progress =
    status.type === "indexing" || status.type === "paused"
        ? status.total
          ? status.processed / status.total
          : 0
        : undefined;

  const content =
    status.type === "loading-model"
      ? "Preparando análise local…"
      : status.type === "indexing"
        ? `Analisando ${status.processed} de ${status.total} notas…`
        : status.type === "paused"
          ? `Análise pausada · ${status.processed} de ${status.total}`
          : status.type === "error"
            ? status.message
            : "Relações atualizadas";
  const Icon =
    status.type === "error"
      ? AlertCircle
      : status.type === "paused"
        ? Pause
        : status.type === "ready"
          ? Check
          : LoaderCircle;

  return (
    <div
      className={status.type === "error" ? "text-[#8f2942]" : "text-text-secondary"}
      role={status.type === "error" ? "alert" : "status"}
    >
      <p className="flex items-center gap-1.5 text-xs">
        <Icon
          className={`size-3.5 shrink-0 ${status.type === "loading-model" || status.type === "indexing" ? "animate-spin" : ""}`}
          strokeWidth={1.8}
        />
        <span>{content}</span>
      </p>
      {progress !== undefined ? (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-tertiary"
          role="progressbar"
          aria-label="Progresso da análise de conexões"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span
            className="block h-full rounded-full bg-hz-accent transition-[width]"
            style={{ width: `${Math.max(3, progress * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
