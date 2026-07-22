/**
 * Recorte do grafo mostrado no canvas.
 *
 * Acima de 150 notas o desenho fica ilegível e a simulação de forças, que é
 * O(n²) por passo, começa a pesar — então o recorte mantém as mais recentes.
 */

import { useMemo } from "react";

import type { EdgeInfo, GraphNote, KnowledgeSnapshot } from "../model/knowledgeModel";

const MAX_NODES = 150;

export interface FilteredGraph {
  notes: GraphNote[];
  edges: EdgeInfo[];
}

export function useFilteredGraph(
  snapshot: KnowledgeSnapshot,
  folderFilter: string,
  strengthFilter: string
): FilteredGraph {
  return useMemo(() => {
    let notes = snapshot.notes.filter(
      (note) => folderFilter === "all" || note.folder === folderFilter
    );
    const allowed = new Set(notes.map((note) => note.id));
    let edges = snapshot.edges.filter((edge) => allowed.has(edge.a) && allowed.has(edge.b));

    if (strengthFilter !== "all") {
      edges = edges.filter((edge) => edge.level === strengthFilter);
      const connected = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
      notes = notes.filter((note) => connected.has(note.id));
    }

    if (notes.length > MAX_NODES) {
      notes = [...notes]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, MAX_NODES);
      const limited = new Set(notes.map((note) => note.id));
      edges = edges.filter((edge) => limited.has(edge.a) && limited.has(edge.b));
    }

    return { notes, edges };
  }, [snapshot, folderFilter, strengthFilter]);
}
