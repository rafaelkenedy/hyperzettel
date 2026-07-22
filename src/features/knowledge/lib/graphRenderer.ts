/**
 * Desenho do grafo em Canvas 2D.
 * Porte de `src/presentation/knowledge/graph-renderer.js`.
 *
 * Sem bibliotecas e sem animação contínua: só redesenha quando algo muda.
 * A paleta é fixa (o app tem um único tema claro), então o fundo escuro do
 * grafo funciona como um "céu" contrastante dentro da gaveta.
 */

import type { EdgeInfo } from "../model/knowledgeModel";
import {
  hash,
  project,
  resolveGraphFocus,
  type Camera,
  type GraphFocus,
  type GraphNode,
  type ProjectedNode
} from "./graphLayout";

/** Exportada para a legenda usar exatamente as cores desenhadas. */
export const PALETTE = {
  background: ["#20304b", "#121e31", "#0d1625"],
  star: "#b4cfeb",
  labelBackground: "rgba(9,16,28,.78)",
  labelText: "#eff4fc",
  nodeStroke: "rgba(255,255,255,.72)",
  selection: "#ffffff",
  empty: "rgba(231,239,251,.78)",
  nodes: {
    inbox: "#c99bee",
    projects: "#b48add",
    areas: "#66cbb6",
    resources: "#78aee8",
    archive: "#a4adbd",
    journal: "#ef9cae"
  } as Record<string, string>,
  nodeDefault: "#a5aee0",
  edges: {
    strong: "#66d8c0",
    medium: "#86a6e2",
    weak: "#ef8fa3"
  } as Record<string, string>
};

interface DrawArgs {
  nodes: GraphNode[];
  edges: EdgeInfo[];
  camera: Camera;
  selectedId: string | null;
  hoveredId: string | null;
}

export function createGraphRenderer(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false });

  function drawBackground(width: number, height: number): void {
    if (!context) return;
    const background = context.createRadialGradient(
      width * 0.48,
      height * 0.42,
      10,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    background.addColorStop(0, PALETTE.background[0]);
    background.addColorStop(0.62, PALETTE.background[1]);
    background.addColorStop(1, PALETTE.background[2]);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    // Estrelas de posição determinística, para o fundo não "piscar" a cada frame.
    for (let index = 0; index < 36; index += 1) {
      const seed = hash(`star-${index}`);
      context.save();
      context.fillStyle = PALETTE.star;
      context.globalAlpha = 0.05 + (seed % 5) * 0.012;
      context.beginPath();
      context.arc(
        ((seed % 997) / 997) * width,
        (((seed >>> 10) % 991) / 991) * height,
        0.7 + (seed % 2),
        0,
        Math.PI * 2
      );
      context.fill();
      context.restore();
    }
  }

  function drawEdge(
    a: ProjectedNode,
    b: ProjectedNode,
    edge: EdgeInfo,
    active: boolean,
    focused: boolean
  ): void {
    if (!context) return;
    context.save();
    context.strokeStyle = PALETTE.edges[edge.level] ?? PALETTE.edges.medium;
    context.globalAlpha = focused
      ? active
        ? 0.52 + edge.strength * 0.42
        : 0.012
      : 0.1 + edge.strength * 0.56;
    context.lineWidth = focused
      ? active
        ? 1.15 + edge.strength * 2.35
        : 0.4
      : 0.65 + edge.strength * 1.35;
    // Traço indica a força: sólido forte, tracejado médio, pontilhado fraco.
    context.setLineDash(
      edge.level === "weak" ? [0.1, 5.5] : edge.level === "medium" ? [8, 5] : []
    );
    context.lineCap = edge.level === "medium" ? "butt" : "round";
    if (focused && active) {
      context.shadowColor = context.strokeStyle as string;
      context.shadowBlur = 5 + edge.strength * 7;
    }
    context.beginPath();
    context.moveTo(a.screenX, a.screenY);
    const bend = (a.depth - b.depth) * 0.08;
    context.quadraticCurveTo(
      (a.screenX + b.screenX) / 2 + bend,
      (a.screenY + b.screenY) / 2 - bend,
      b.screenX,
      b.screenY
    );
    context.stroke();
    context.restore();
  }

  function drawEdges(
    projected: ProjectedNode[],
    edges: EdgeInfo[],
    focus: GraphFocus | null
  ): void {
    const projectedMap = new Map(projected.map((node) => [node.id, node]));
    const orderedEdges = focus
      ? [...edges].sort(
          (a, b) => Number(focus.includesEdge(a)) - Number(focus.includesEdge(b))
        )
      : edges;

    orderedEdges.forEach((edge) => {
      const a = projectedMap.get(edge.a);
      const b = projectedMap.get(edge.b);
      if (!a || !b) return;
      drawEdge(a, b, edge, !focus || focus.includesEdge(edge), Boolean(focus));
    });
  }

  function drawSelectionRing(node: ProjectedNode): void {
    if (!context) return;
    context.globalAlpha = 0.72;
    context.beginPath();
    context.arc(node.screenX, node.screenY, node.screenRadius + 7, 0, Math.PI * 2);
    context.strokeStyle = PALETTE.edges[node.level] ?? PALETTE.edges.medium;
    context.lineWidth = 1.7;
    context.stroke();
  }

  function drawNode(
    node: ProjectedNode,
    selected: boolean,
    hovered: boolean,
    active: boolean,
    focused: boolean
  ): void {
    if (!context) return;
    const color = PALETTE.nodes[node.folder] ?? PALETTE.nodeDefault;
    context.save();
    context.globalAlpha =
      focused && !active ? (hovered ? 0.32 : 0.085) : 0.62 + node.strength * 0.38;
    if (active && (node.strength > 0.68 || selected)) {
      context.shadowColor = selected ? PALETTE.selection : color;
      context.shadowBlur = selected ? 22 : 11 * node.strength;
    }
    context.fillStyle = color;
    context.beginPath();
    context.arc(node.screenX, node.screenY, Math.max(3.2, node.screenRadius), 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = selected ? 2.4 : hovered ? 1.7 : 1;
    context.globalAlpha =
      focused && !active
        ? hovered
          ? 0.45
          : 0.08
        : selected
          ? 1
          : 0.3 + node.strength * 0.5;
    context.strokeStyle = selected ? PALETTE.selection : PALETTE.nodeStroke;
    context.stroke();
    if (selected) drawSelectionRing(node);
    context.restore();
  }

  function overlaps(
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number }
  ): boolean {
    const gap = 3;
    return (
      a.left < b.left + b.width + gap &&
      a.left + a.width + gap > b.left &&
      a.top < b.top + b.height + gap &&
      a.top + a.height + gap > b.top
    );
  }

  function findLabelPlacement(
    node: ProjectedNode,
    selected: boolean,
    width: number,
    height: number,
    occupied: { left: number; top: number; width: number; height: number }[]
  ) {
    if (!context) return null;
    const title = node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title;
    context.font = `${selected ? 650 : 550} 9px Inter, sans-serif`;
    const boxWidth = context.measureText(title).width + 9;

    for (const offset of [0, -22, 22, -44, 44]) {
      let left = node.screenX + node.screenRadius + 7;
      if (left + boxWidth > width - 4) left = node.screenX - node.screenRadius - boxWidth - 7;
      left = Math.max(4, Math.min(width - boxWidth - 4, left));
      const top = Math.max(4, Math.min(height - 22, node.screenY - 17 + offset));
      const placement = { left, top, width: boxWidth, height: 18, title };
      if (selected || !occupied.some((area) => overlaps(area, placement))) return placement;
    }
    return null;
  }

  function drawLabel(
    selected: boolean,
    placement: { left: number; top: number; width: number; height: number; title: string }
  ): void {
    if (!context) return;
    context.save();
    context.font = `${selected ? 650 : 550} 9px Inter, sans-serif`;
    context.fillStyle = PALETTE.labelBackground;
    context.beginPath();
    context.roundRect(placement.left, placement.top, placement.width, placement.height, 5);
    context.fill();
    context.fillStyle = PALETTE.labelText;
    context.fillText(placement.title, placement.left + 4.5, placement.top + 12.5);
    context.restore();
  }

  /** Rotula os seis nós mais conectados, mais o selecionado e o sob o cursor. */
  function drawLabels(
    projected: ProjectedNode[],
    selectedId: string | null,
    hoveredId: string | null,
    width: number,
    height: number,
    focus: GraphFocus | null
  ): void {
    const automaticLabels = new Set(
      [...projected]
        .sort((a, b) => b.degree - a.degree || b.strength - a.strength)
        .slice(0, 6)
        .map((node) => node.id)
    );

    const candidates = projected.filter((node) =>
      focus
        ? focus.includesNode(node.id)
        : node.id === selectedId || node.id === hoveredId || automaticLabels.has(node.id)
    );

    candidates.sort(
      (a, b) =>
        Number(b.id === selectedId) - Number(a.id === selectedId) ||
        Number(b.id === hoveredId) - Number(a.id === hoveredId) ||
        b.degree - a.degree
    );

    const occupied: { left: number; top: number; width: number; height: number }[] = [];
    candidates.forEach((node) => {
      const selected = node.id === selectedId;
      const placement = findLabelPlacement(node, selected, width, height, occupied);
      if (!placement) return;
      occupied.push(placement);
      drawLabel(selected, placement);
    });
  }

  function drawEmpty(width: number, height: number): void {
    if (!context) return;
    context.fillStyle = PALETTE.empty;
    context.font = "500 11px Inter, sans-serif";
    context.textAlign = "center";
    context.fillText("Nenhum neurônio corresponde aos filtros.", width / 2, height / 2);
  }

  function draw({ nodes, edges, camera, selectedId, hoveredId }: DrawArgs): ProjectedNode[] {
    if (!context) return [];
    const rectangle = canvas.getBoundingClientRect();
    const width = rectangle.width;
    const height = rectangle.height;
    const ratio = Math.min(2, devicePixelRatio || 1);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    drawBackground(width, height);
    const projected = nodes.map((node) => project(node, camera, width, height));
    const focus = resolveGraphFocus(projected, edges, selectedId);

    drawEdges(projected, edges, focus);

    const rank = (node: ProjectedNode) =>
      node.id === selectedId ? 2 : focus?.includesNode(node.id) ? 1 : 0;
    [...projected]
      .sort((a, b) => rank(a) - rank(b) || b.depth - a.depth)
      .forEach((node) =>
        drawNode(
          node,
          node.id === selectedId,
          node.id === hoveredId,
          !focus || focus.includesNode(node.id),
          Boolean(focus)
        )
      );

    drawLabels(projected, selectedId, hoveredId, width, height, focus);
    if (!nodes.length) drawEmpty(width, height);

    return projected;
  }

  return { draw };
}
