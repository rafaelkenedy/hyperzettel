/**
 * Mapa de conhecimento.
 *
 * O grafo é a superfície principal e ocupa toda a área útil; métricas,
 * filtros, curva e fila de revisão ficam num painel à direita. Assim as três
 * visualizações do original convivem: dá para percorrer a fila de revisão
 * vendo o grafo reagir ao lado, em vez de alternar telas.
 *
 * Este arquivo é só a casca: cada aba mora no seu próprio componente.
 */

import { useMemo, useRef, useState } from "react";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@relume_io/relume-ui";
import { X } from "lucide-react";

import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNavigation, type MapTab } from "@/app/providers/NavigationProvider";
import { percent } from "../lib/format";
import { useFilteredGraph } from "../lib/useFilteredGraph";
import { ExplorePanel } from "./ExplorePanel";
import { GraphSurface } from "./GraphSurface";
import type { KnowledgeGraphHandle } from "./KnowledgeGraph";
import { Metric } from "./MapPrimitives";
import { RetentionCurve, type CurveRange } from "./RetentionCurve";
import { ReviewQueue } from "./ReviewQueue";

const TABS: [MapTab, string][] = [
  ["explore", "Explorar"],
  ["curve", "Curva"],
  ["review", "Revisões"]
];

const RANGES: CurveRange[] = [30, 90, "all"];

export function KnowledgeMap() {
  const knowledge = useKnowledge();
  const navigation = useNavigation();

  const [range, setRange] = useState<CurveRange>(30);
  const [folderFilter, setFolderFilter] = useState("all");
  const [strengthFilter, setStrengthFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const controlsRef = useRef<KnowledgeGraphHandle | null>(null);

  const graph = useFilteredGraph(knowledge.snapshot, folderFilter, strengthFilter);
  const selected = graph.notes.find((note) => note.id === selectedId) ?? null;

  const connectionCount = useMemo(
    () =>
      selectedId
        ? knowledge.snapshot.edges.filter(
            (edge) => edge.a === selectedId || edge.b === selectedId
          ).length
        : 0,
    [knowledge.snapshot.edges, selectedId]
  );

  /** Selecionar da fila também move o foco do grafo, sem interromper a revisão. */
  function focusNote(id: string | null) {
    setSelectedId(id);
  }

  const { metrics, notes } = knowledge.snapshot;

  return (
    <section className="flex h-full min-w-0 flex-1">
      <GraphSurface
        graph={graph}
        selected={selected}
        selectedId={selectedId}
        onSelect={setSelectedId}
        controlsRef={controlsRef}
      />

      <aside className="flex w-[21rem] shrink-0 flex-col border-l border-border-primary bg-background-primary">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-primary px-4">
          <h2 className="flex-1 text-[13px] font-semibold">Mapa de conhecimento</h2>
          <span className="text-2xs text-text-secondary">⌘G</span>
          <Button
            variant="link"
            size="sm"
            aria-label="Fechar mapa"
            className="size-7 p-0 text-text-secondary hover:text-text-primary"
            onClick={() => navigation.toggleMap()}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border-primary p-3">
          <Metric
            label="Retenção média"
            value={metrics.average === null ? "—" : percent(metrics.average)}
          />
          <Metric label="A revisar" value={metrics.reviewDue} />
          <Metric label="Notas" value={notes.length} />
          <Metric label="Conexões fortes" value={metrics.strongEdges} />
        </div>

        <Tabs
          value={navigation.mapTab}
          onValueChange={(value) => navigation.setMapTab(value as MapTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="mx-3 mt-3 grid shrink-0 grid-cols-3 rounded-lg bg-background-secondary p-1">
            {TABS.map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  "rounded-md px-2 py-1 text-xs text-text-secondary",
                  "data-[state=active]:bg-background-primary data-[state=active]:font-medium data-[state=active]:text-text-primary data-[state=active]:shadow-panel"
                )}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="hz-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <TabsContent value="explore" className="mt-3">
              <ExplorePanel
                graph={graph}
                selected={selected}
                selectedId={selectedId}
                onSelect={setSelectedId}
                folderFilter={folderFilter}
                onFolderFilter={setFolderFilter}
                strengthFilter={strengthFilter}
                onStrengthFilter={setStrengthFilter}
                connectionCount={connectionCount}
              />
            </TabsContent>

            <TabsContent value="curve" className="mt-3">
              <div className="mb-3 flex items-center gap-1">
                {RANGES.map((option) => (
                  <button
                    key={String(option)}
                    type="button"
                    onClick={() => setRange(option)}
                    className={cn(
                      "rounded-md px-2 py-1 text-2xs",
                      range === option
                        ? "bg-hz-relation font-medium text-hz-relation-ink"
                        : "text-text-secondary hover:bg-hz-hover"
                    )}
                  >
                    {option === "all" ? "Tudo" : `${option} dias`}
                  </button>
                ))}
              </div>
              <RetentionCurve range={range} />
            </TabsContent>

            <TabsContent value="review" className="mt-3">
              <ReviewQueue
                selectedId={selectedId}
                onFocus={focusNote}
                requestedId={navigation.reviewTargetId}
                onRequestConsumed={navigation.clearReviewTarget}
              />
            </TabsContent>
          </div>
        </Tabs>
      </aside>
    </section>
  );
}
