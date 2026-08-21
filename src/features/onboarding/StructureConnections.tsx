import { ArrowRight, Link2 } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { KindBadge } from "@/features/notes/components/KindBadge";

export function StructureConnections() {
  const notes = useNotes();
  if (notes.draft.kind !== "structure") return null;

  return (
    <section className="mt-10 border-t border-border-primary pt-6" aria-labelledby="map-notes-title">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-[#efecfd] text-[#6a4fd0]">
          <Link2 className="size-4" strokeWidth={1.8} aria-hidden />
        </span>
        <div>
          <h2 id="map-notes-title" className="text-sm font-bold">
            Notas deste mapa
          </h2>
          <p className="text-2xs text-text-secondary">
            {notes.relations.length
              ? `${notes.relations.length} ${notes.relations.length === 1 ? "ideia conectada" : "ideias conectadas"}`
              : "As ideias conectadas aparecerão aqui."}
          </p>
        </div>
      </div>

      {notes.relations.length ? (
        <ol className="mt-3 flex flex-col gap-2">
          {notes.relations.map((relation) => {
            const title = relation.note.title || "Sem título";
            const reason = relation.reason || relation.incomingReason;
            return (
              <li key={relation.note.id}>
                <button
                  type="button"
                  onClick={() => void notes.openNote(relation.note.id)}
                  aria-label={`Abrir ${title}`}
                  className="group flex w-full items-start gap-3 rounded-lg border border-border-secondary bg-background-secondary p-3 text-left transition-colors hover:border-hz-accent/30 hover:bg-hz-hover"
                >
                  <KindBadge kind={relation.note.kind} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-2xs leading-relaxed text-text-tertiary">
                      {reason || "Conexão ainda sem motivo registrado."}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 size-3.5 shrink-0 text-text-secondary transition-transform group-hover:translate-x-0.5"
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border-tertiary bg-background-secondary px-4 py-5 text-center text-xs text-text-secondary">
          Crie uma captura, transforme-a em nota permanente e explique a conexão com este mapa.
        </div>
      )}
    </section>
  );
}
