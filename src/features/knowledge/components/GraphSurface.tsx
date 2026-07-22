/**
 * A superfície do grafo, com os controles flutuando sobre o canvas.
 *
 * O canvas ocupa toda a área; nada de cromo fixo em volta, para o desenho
 * respirar. Os controles usam fundo translúcido escuro porque vivem sobre o
 * "céu" do grafo, não sobre o tema claro do app.
 */

import type { RefObject } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { KnowledgeGraph, type KnowledgeGraphHandle } from "./KnowledgeGraph";
import type { FilteredGraph } from "../lib/useFilteredGraph";
import type { GraphNote } from "../model/knowledgeModel";

export function GraphSurface({
  graph,
  selected,
  selectedId,
  onSelect,
  controlsRef
}: {
  graph: FilteredGraph;
  selected: GraphNote | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  controlsRef: RefObject<KnowledgeGraphHandle | null>;
}) {
  const controls = [
    { icon: Plus, label: "Aproximar", run: () => controlsRef.current?.zoomIn() },
    { icon: Minus, label: "Afastar", run: () => controlsRef.current?.zoomOut() },
    { icon: Maximize, label: "Redefinir visão", run: () => controlsRef.current?.resetView() }
  ];

  return (
    <div className="relative min-w-0 flex-1 bg-[#0d1625]">
      <KnowledgeGraph
        notes={graph.notes}
        edges={graph.edges}
        selectedId={selectedId}
        onSelect={onSelect}
        controlsRef={controlsRef}
      />

      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        <p className="rounded-md bg-[rgba(9,16,28,.55)] px-2.5 py-1 text-2xs text-[#c8d6ea] backdrop-blur">
          {graph.notes.length} {graph.notes.length === 1 ? "neurônio" : "neurônios"} ·{" "}
          {graph.edges.length} {graph.edges.length === 1 ? "conexão" : "conexões"}
        </p>
        {selected ? (
          <p className="max-w-[18rem] truncate rounded-md bg-[rgba(9,16,28,.55)] px-2.5 py-1 text-2xs text-[#eff4fc] backdrop-blur">
            {selected.title}
          </p>
        ) : null}
      </div>

      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        {controls.map(({ icon: Icon, label, run }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={run}
            className="grid size-8 place-items-center rounded-md bg-[rgba(9,16,28,.6)] text-[#c8d6ea] backdrop-blur transition-colors hover:bg-[rgba(9,16,28,.85)] hover:text-white"
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>

      {graph.notes.length ? (
        <p className="pointer-events-none absolute bottom-4 left-4 text-2xs text-[#8ea3c0]">
          Arraste para girar · roda para aproximar · clique para focar
        </p>
      ) : null}
    </div>
  );
}
