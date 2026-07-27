/** Filtros, seleção e legenda — a aba de exploração do painel. */

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn
} from "@relume_io/relume-ui";
import { ArrowRight } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { FOLDER_LABELS, type FolderId } from "@/domain/notes";
import { LEVEL_TONE, dueSummary, percent } from "../lib/format";
import type { FilteredGraph } from "../lib/useFilteredGraph";
import type { GraphNote } from "../model/knowledgeModel";
import { Legend, PanelLabel } from "./MapPrimitives";
import { ActiveRecall } from "./ActiveRecall";

const FILTER_CLASS =
  "h-8 rounded-md border-border-primary bg-background-secondary px-2 text-xs";

export function ExplorePanel({
  graph,
  selected,
  selectedId,
  onSelect,
  folderFilter,
  onFolderFilter,
  strengthFilter,
  onStrengthFilter,
  connectionCount
}: {
  graph: FilteredGraph;
  selected: GraphNote | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  folderFilter: string;
  onFolderFilter: (value: string) => void;
  strengthFilter: string;
  onStrengthFilter: (value: string) => void;
  connectionCount: number;
}) {
  const notes = useNotes();
  const selectedNote = selected
    ? notes.savedNotes.find((candidate) => candidate.id === selected.id)
    : null;
  const canReview =
    selectedNote?.status === "saved" && selectedNote.kind !== "fleeting";

  return (
    <>
      <PanelLabel>Filtros</PanelLabel>
      <div className="flex flex-col gap-2">
        <Select value={folderFilter} onValueChange={onFolderFilter}>
          <SelectTrigger aria-label="Filtrar por pasta" className={FILTER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all" className="text-xs">
              Todas as pastas
            </SelectItem>
            {(Object.keys(FOLDER_LABELS) as FolderId[]).map((folder) => (
              <SelectItem key={folder} value={folder} className="text-xs">
                {FOLDER_LABELS[folder]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={strengthFilter} onValueChange={onStrengthFilter}>
          <SelectTrigger aria-label="Filtrar por força" className={FILTER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="text-xs">
            <SelectItem value="all" className="text-xs">
              Todas as forças
            </SelectItem>
            <SelectItem value="strong" className="text-xs">
              Fortes
            </SelectItem>
            <SelectItem value="medium" className="text-xs">
              Médias
            </SelectItem>
            <SelectItem value="weak" className="text-xs">
              Fracas
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Alternativa acessível ao canvas: seleção por lista. */}
        <Select value={selectedId ?? ""} onValueChange={(value) => onSelect(value || null)}>
          <SelectTrigger aria-label="Selecionar nota no grafo" className={FILTER_CLASS}>
            <SelectValue placeholder="Selecione um neurônio…" />
          </SelectTrigger>
          <SelectContent className="max-h-72 text-xs">
            {[...graph.notes]
              .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"))
              .map((note) => (
                <SelectItem key={note.id} value={note.id} className="text-xs">
                  {note.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <PanelLabel>Seleção</PanelLabel>
      {selected ? (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs font-semibold tabular-nums",
                LEVEL_TONE[selected.level]
              )}
            >
              {percent(selected.strength)}
            </span>
            <span className="text-2xs text-text-secondary">
              {connectionCount} {connectionCount === 1 ? "conexão" : "conexões"} ·{" "}
              {selected.reviewCount} {selected.reviewCount === 1 ? "revisão" : "revisões"}
            </span>
          </div>

          <p className="mt-1.5 text-xs font-medium leading-snug">{selected.title}</p>
          <p className="mt-0.5 text-2xs text-text-secondary">
            {FOLDER_LABELS[selected.folder as FolderId] ?? "Notas"} · {dueSummary(selected.dueAt)}
          </p>

          <div className="mt-2.5">
            {canReview ? (
              <ActiveRecall
                noteId={selected.id}
                title={selected.title}
                content={selectedNote.content}
                compact
              />
            ) : (
              <p className="rounded-md bg-background-primary p-2.5 text-2xs leading-relaxed text-text-secondary">
                Conclua a nota e processe capturas fugazes antes de revisar.
              </p>
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <Button
              variant="link"
              size="sm"
              className="h-7 gap-1 px-1 text-2xs text-hz-accent"
              onClick={() => void notes.openNote(selected.id)}
            >
              Abrir nota
              <ArrowRight className="size-3" strokeWidth={2} />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-text-secondary">
          Clique num neurônio para destacar suas conexões diretas.
        </p>
      )}

      <Legend />
    </>
  );
}
