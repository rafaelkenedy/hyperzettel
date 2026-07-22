import { Link2, LoaderCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";

import type { Note } from "@/domain/notes";
import { toPlainText } from "@/shared/html";
import { useKnowledgeRelations } from "./KnowledgeRelationsProvider";

const COMMON_WORDS = new Set([
  "para", "como", "com", "uma", "esse", "essa", "esta", "este", "dos", "das",
  "que", "por", "mais", "seus", "suas", "sobre", "entre", "quando", "onde",
  "the", "and", "with", "from", "that", "this", "into", "your"
]);

function normalizeTerm(term: string): string {
  return term
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function keyTerms(note: Note): Map<string, string> {
  const text = `${note.title} ${toPlainText(note.content)}`;
  const terms = new Map<string, string>();
  for (const term of text.match(/[\p{L}\p{N}+#]{4,}/gu) ?? []) {
    const normalized = normalizeTerm(term);
    if (!COMMON_WORDS.has(normalized) && !terms.has(normalized)) {
      terms.set(normalized, term.toLocaleLowerCase("pt-BR"));
    }
  }
  return terms;
}

function sharedTerms(source: Note | null, target: Note): string[] {
  if (!source) return [];
  const sourceTerms = keyTerms(source);
  return [...keyTerms(target)]
    .filter(([normalized]) => sourceTerms.has(normalized))
    .map(([, displayed]) => displayed)
    .slice(0, 3);
}

export function RelatedNotes({
  onConnected,
  onRejected
}: {
  onConnected?: (note: Note) => void;
  onRejected?: (note: Note, restore: () => Promise<void>) => void;
}) {
  const relations = useKnowledgeRelations();
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const analyzing =
    relations.status.type === "loading-model" || relations.status.type === "indexing";

  return (
    <>
      {actionError ? (
        <p className="mb-2 text-xs text-[#8f2942]" role="alert">
          {actionError}
        </p>
      ) : null}
      {!relations.related.length ? (
        <p className="py-1 text-xs text-text-secondary">
          {analyzing
            ? "As sugestões aparecerão conforme esta nota for analisada."
            : relations.status.type === "error"
              ? "As sugestões voltarão depois que a análise for retomada."
              : "Nenhuma sugestão encontrada para esta versão da nota."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {relations.related.map(({ relation, note }) => {
            const terms = sharedTerms(relations.activeNote, note);
            return (
              <li
                key={relation.id}
                className="group rounded-md border border-dashed border-border-tertiary bg-background-primary p-2.5"
              >
              <div className="flex items-start gap-1.5">
                <button
                  type="button"
                  onClick={() => relations.open(note.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block text-[13px] font-semibold leading-snug text-link-primary group-hover:underline">
                    {note.title || "Sem título"}
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-snug text-text-tertiary">
                    {toPlainText(note.content) || "Nota sem conteúdo textual"}
                  </span>
                  {terms.length ? (
                    <span className="mt-1 block text-xs leading-snug text-text-secondary">
                      Em comum: <strong className="font-medium text-text-primary">{terms.join(", ")}</strong>
                    </span>
                  ) : null}
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1">
                <span className="flex min-w-0 items-center gap-1 truncate text-2xs font-medium uppercase tracking-[0.06em] text-text-secondary">
                  <Sparkles className="size-2.5 shrink-0" /> sugestão automática
                </span>
                <button
                  type="button"
                  onClick={() => {
                    relations.connect(note.id);
                    onConnected?.(note);
                  }}
                  aria-label={`Criar conexão com ${note.title || "nota sem título"}`}
                  className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-hz-accent/25 bg-[#f4f6fd] px-2.5 text-xs font-semibold text-hz-accent hover:border-hz-accent/50 hover:bg-[#e9edfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent focus-visible:ring-offset-1"
                >
                  <Link2 className="size-3.5" strokeWidth={2} />
                  Conectar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setPendingRejectId(relation.id);
                    setActionError("");
                    try {
                      await relations.reject(relation);
                      onRejected?.(note, async () => {
                        try {
                          await relations.restore(relation);
                        } catch {
                          setActionError("Não foi possível restaurar a sugestão.");
                        }
                      });
                    } catch {
                      setActionError("Não foi possível ocultar a sugestão. Tente novamente.");
                    } finally {
                      setPendingRejectId(null);
                    }
                  }}
                  disabled={pendingRejectId === relation.id}
                  aria-label={`Ocultar sugestão ${note.title || "sem título"}`}
                  title="Ocultar sugestão"
                  className="grid size-8 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-background-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent focus-visible:ring-offset-1"
                >
                  {pendingRejectId === relation.id ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                </button>
              </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
