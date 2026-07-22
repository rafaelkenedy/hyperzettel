/**
 * Grafo neural em Canvas. Porte de `graph-engine.js` para React.
 *
 * O canvas é território imperativo: nós, câmera e projeção ficam em refs e o
 * desenho é agendado por requestAnimationFrame. O React só entra para trocar
 * os dados e reportar a seleção.
 */

import { useCallback, useEffect, useRef } from "react";

import type { EdgeInfo, GraphNote } from "../model/knowledgeModel";
import { FOLDER_LABELS, type FolderId } from "@/domain/notes";
import {
  buildGraph,
  type Camera,
  type GraphNode,
  type ProjectedNode,
  type SavedLayout
} from "../lib/graphLayout";
import { createGraphRenderer } from "../lib/graphRenderer";

const LAYOUT_KEY = "hyperzettel-graph-layout";

function defaultCamera(): Camera {
  return { yaw: -0.12, pitch: 0.08, zoom: 0.62, panX: 0, panY: 0 };
}

function readSavedLayout(): SavedLayout {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as SavedLayout;
  } catch {
    return {};
  }
}

export interface KnowledgeGraphHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

export function KnowledgeGraph({
  notes,
  edges,
  selectedId,
  onSelect,
  controlsRef
}: {
  notes: GraphNote[];
  edges: EdgeInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  controlsRef: React.MutableRefObject<KnowledgeGraphHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReturnType<typeof createGraphRenderer> | null>(null);
  /** O renderizador guarda o contexto de um canvas específico. */
  const rendererCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<EdgeInfo[]>([]);
  const projectedRef = useRef<ProjectedNode[]>([]);
  const cameraRef = useRef<Camera>(defaultCamera());
  const savedLayoutRef = useRef<SavedLayout>(readSavedLayout());
  const selectedRef = useRef<string | null>(selectedId);
  const hoveredRef = useRef<string | null>(null);
  const drawRequestRef = useRef(0);
  const persistTimerRef = useRef(0);
  const pointerRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);

  selectedRef.current = selectedId;

  const scheduleDraw = useCallback(() => {
    if (drawRequestRef.current) return;
    drawRequestRef.current = requestAnimationFrame(() => {
      drawRequestRef.current = 0;
      const renderer = rendererRef.current;
      if (!renderer) return;
      projectedRef.current = renderer.draw({
        nodes: nodesRef.current,
        edges: edgesRef.current,
        camera: cameraRef.current,
        selectedId: selectedRef.current,
        hoveredId: hoveredRef.current
      });
      // Ordena uma vez por frame; o hit-test roda a cada pointermove.
      projectedRef.current.sort((left, right) => left.depth - right.depth);
    });
  }, []);

  const persistLayout = useCallback(() => {
    nodesRef.current.forEach((node) => {
      savedLayoutRef.current[node.id] = { x: node.x, y: node.y, z: node.z };
    });
    const activeIds = new Set(nodesRef.current.map((node) => node.id));
    Object.keys(savedLayoutRef.current).forEach((id) => {
      if (!activeIds.has(id)) delete savedLayoutRef.current[id];
    });
    // A posição dos nós é só cache: gravar a cada rebuild seria desperdício.
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(savedLayoutRef.current));
      } catch {
        // Sem localStorage o layout apenas recomeça na próxima abertura.
      }
    }, 1500);
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rectangle = canvas.getBoundingClientRect();
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rectangle.width * ratio));
    const height = Math.max(1, Math.round(rectangle.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    scheduleDraw();
  }, [scheduleDraw]);

  // Reconstrói o layout quando o conjunto de notas ou conexões muda.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Recria o renderizador se o React trocou o elemento de canvas.
    if (!rendererRef.current || rendererCanvasRef.current !== canvas) {
      rendererRef.current = createGraphRenderer(canvas);
      rendererCanvasRef.current = canvas;
    }

    const graph = buildGraph({ notes, edges }, nodesRef.current, savedLayoutRef.current);
    nodesRef.current = graph.nodes;
    edgesRef.current = graph.edges;
    persistLayout();
    resize();
    scheduleDraw();
  }, [notes, edges, persistLayout, resize, scheduleDraw]);

  useEffect(() => scheduleDraw(), [selectedId, scheduleDraw]);

  useEffect(() => {
    controlsRef.current = {
      zoomIn: () => {
        cameraRef.current.zoom = Math.min(2.2, cameraRef.current.zoom * 1.16);
        scheduleDraw();
      },
      zoomOut: () => {
        cameraRef.current.zoom = Math.max(0.55, cameraRef.current.zoom / 1.16);
        scheduleDraw();
      },
      resetView: () => {
        cameraRef.current = defaultCamera();
        scheduleDraw();
      }
    };
  }, [controlsRef, scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(
    () => () => {
      cancelAnimationFrame(drawRequestRef.current);
      // Zerar é obrigatório: se o id ficar guardado, `scheduleDraw` acredita
      // que ainda há um frame pendente e nunca mais agenda outro. Acontece
      // em toda remontagem — inclusive a que o StrictMode provoca.
      drawRequestRef.current = 0;
      window.clearTimeout(persistTimerRef.current);
    },
    []
  );

  function localPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  }

  function hitNode(x: number, y: number): ProjectedNode | null {
    return (
      projectedRef.current.find(
        (node) => Math.hypot(node.screenX - x, node.screenY - y) <= Math.max(10, node.screenRadius + 6)
      ) ?? null
    );
  }

  function showTooltip(node: ProjectedNode | null, point: { x: number; y: number }): void {
    const tooltip = tooltipRef.current;
    const canvas = canvasRef.current;
    if (!tooltip || !canvas) return;
    if (!node) {
      tooltip.hidden = true;
      return;
    }
    const folder = FOLDER_LABELS[node.folder as FolderId] ?? "Notas";
    tooltip.textContent = `${node.title} — ${folder} · ${Math.round(node.strength * 100)}%`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(canvas.clientWidth - 230, Math.max(8, point.x + 12))}px`;
    tooltip.style.top = `${Math.min(canvas.clientHeight - 46, Math.max(8, point.y + 12))}px`;
  }

  return (
    <div className="relative size-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="size-full cursor-grab touch-none active:cursor-grabbing"
        aria-label="Grafo de conhecimento"
        role="img"
        onPointerDown={(event) => {
          const point = localPoint(event);
          pointerRef.current = {
            id: event.pointerId,
            startX: point.x,
            startY: point.y,
            lastX: point.x,
            lastY: point.y,
            moved: false
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const point = localPoint(event);
          const pointer = pointerRef.current;

          if (pointer?.id === event.pointerId) {
            const dx = point.x - pointer.lastX;
            const dy = point.y - pointer.lastY;
            if (Math.hypot(point.x - pointer.startX, point.y - pointer.startY) > 4) {
              pointer.moved = true;
            }
            cameraRef.current.yaw += dx * 0.005;
            cameraRef.current.pitch = Math.max(
              -0.8,
              Math.min(0.8, cameraRef.current.pitch + dy * 0.004)
            );
            pointer.lastX = point.x;
            pointer.lastY = point.y;
            if (tooltipRef.current) tooltipRef.current.hidden = true;
            scheduleDraw();
            return;
          }

          const node = hitNode(point.x, point.y);
          hoveredRef.current = node?.id ?? null;
          showTooltip(node, point);
          scheduleDraw();
        }}
        onPointerUp={(event) => {
          const pointer = pointerRef.current;
          if (!pointer || pointer.id !== event.pointerId) return;
          const point = localPoint(event);
          // Arrastar gira a câmera; clique sem arrastar seleciona.
          if (!pointer.moved) onSelect(hitNode(point.x, point.y)?.id ?? null);
          pointerRef.current = null;
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
        }}
        onPointerLeave={() => {
          if (pointerRef.current) return;
          hoveredRef.current = null;
          if (tooltipRef.current) tooltipRef.current.hidden = true;
          scheduleDraw();
        }}
        onWheel={(event) => {
          cameraRef.current.zoom = Math.max(
            0.55,
            Math.min(2.2, cameraRef.current.zoom * (event.deltaY > 0 ? 0.91 : 1.1))
          );
          scheduleDraw();
        }}
      />
      <div
        ref={tooltipRef}
        hidden
        className="pointer-events-none absolute z-10 max-w-[14rem] rounded-md bg-[rgba(9,16,28,.92)] px-2 py-1 text-2xs leading-snug text-[#eff4fc] shadow-pop"
      />
    </div>
  );
}
