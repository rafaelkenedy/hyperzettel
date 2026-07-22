/**
 * Layout do grafo de conhecimento.
 * Porte de `src/presentation/knowledge/graph-layout.js`.
 *
 * As posições saem de uma simulação de forças em 2D (repulsão entre todos os
 * nós, atração pelas arestas) mais um eixo Z derivado da força de retenção:
 * notas fracas afundam, notas fortes vêm para a frente.
 */

import type { EdgeInfo, GraphNote } from "../model/knowledgeModel";

export interface GraphNode extends GraphNote {
  degree: number;
  radius: number;
  x: number;
  y: number;
  z: number;
}

export interface ProjectedNode extends GraphNode {
  screenX: number;
  screenY: number;
  screenRadius: number;
  depth: number;
  perspective: number;
}

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

export type SavedLayout = Record<string, { x: number; y: number; z: number }>;

/** FNV-1a: posição inicial estável por id, sem depender de Math.random. */
export function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function applyEdgeForce(
  edge: EdgeInfo,
  nodes: GraphNode[],
  nodeIndex: Map<string, number>,
  force: { x: number; y: number }[]
): void {
  const aIndex = nodeIndex.get(edge.a);
  const bIndex = nodeIndex.get(edge.b);
  if (aIndex === undefined || bIndex === undefined) return;

  const a = nodes[aIndex];
  const b = nodes[bIndex];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  // Conexões fortes puxam mais: o grafo agrupa o que está bem lembrado.
  const pull = (distance - 88) * 0.0035 * (0.7 + edge.strength);
  force[aIndex].x += (dx / distance) * pull;
  force[aIndex].y += (dy / distance) * pull;
  force[bIndex].x -= (dx / distance) * pull;
  force[bIndex].y -= (dy / distance) * pull;
}

function settle(nodes: GraphNode[], edges: EdgeInfo[], iterations: number): void {
  const nodeIndex = new Map(nodes.map((node, position) => [node.id, position]));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));

    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const distanceSquared = Math.max(90, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const repulsion = 1150 / distanceSquared;
        dx /= distance;
        dy /= distance;
        force[left].x += dx * repulsion * 28;
        force[left].y += dy * repulsion * 28;
        force[right].x -= dx * repulsion * 28;
        force[right].y -= dy * repulsion * 28;
      }
    }

    edges.forEach((edge) => applyEdgeForce(edge, nodes, nodeIndex, force));

    nodes.forEach((node, position) => {
      node.x = Math.max(-290, Math.min(290, node.x + force[position].x - node.x * 0.004));
      node.y = Math.max(-260, Math.min(260, node.y + force[position].y - node.y * 0.004));
      node.z += ((0.5 - node.strength) * 150 - node.z) * 0.06;
    });
  }
}

export function buildGraph(
  data: { notes: GraphNote[]; edges: EdgeInfo[] },
  previousNodes: GraphNode[],
  savedLayout: SavedLayout
): { nodes: GraphNode[]; edges: EdgeInfo[] } {
  const previous = new Map(previousNodes.map((node) => [node.id, node]));
  const degrees = new Map(data.notes.map((note) => [note.id, 0]));

  data.edges.forEach((edge) => {
    degrees.set(edge.a, (degrees.get(edge.a) ?? 0) + 1);
    degrees.set(edge.b, (degrees.get(edge.b) ?? 0) + 1);
  });

  const nodes: GraphNode[] = data.notes.map((note) => {
    const old = previous.get(note.id) ?? savedLayout[note.id];
    const seed = hash(note.id);
    const angle = ((seed % 360) * Math.PI) / 180;
    const ring = 60 + ((seed >>> 8) % 150);
    const degree = degrees.get(note.id) ?? 0;
    return {
      ...note,
      degree,
      radius: 5.5 + Math.min(8, Math.sqrt(degree) * 2.1),
      x: old?.x ?? Math.cos(angle) * ring,
      y: old?.y ?? Math.sin(angle) * ring,
      z: old?.z ?? (0.5 - note.strength) * 150 + ((seed >>> 16) % 40) - 20
    };
  });

  // Grafos grandes recebem menos iterações: o custo é O(n²) por passo.
  settle(nodes, data.edges, nodes.length > 90 ? 38 : 64);
  return { nodes, edges: data.edges };
}

/** Projeção com yaw/pitch e perspectiva simples. */
export function project(
  node: GraphNode,
  camera: Camera,
  width: number,
  height: number
): ProjectedNode {
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);

  const horizontal = node.x * cosYaw - node.z * sinYaw;
  const depthBeforePitch = node.x * sinYaw + node.z * cosYaw;
  const vertical = node.y * cosPitch - depthBeforePitch * sinPitch;
  const depth = node.y * sinPitch + depthBeforePitch * cosPitch;
  const perspective = 520 / Math.max(300, 520 + depth);

  return {
    ...node,
    screenX: width / 2 + camera.panX + horizontal * perspective * camera.zoom,
    screenY: height / 2 + camera.panY + vertical * perspective * camera.zoom,
    screenRadius: node.radius * perspective * Math.sqrt(camera.zoom),
    depth,
    perspective
  };
}

export interface GraphFocus {
  selectedId: string;
  nodeIds: Set<string>;
  neighborIds: Set<string>;
  edges: EdgeInfo[];
  includesNode: (id: string) => boolean;
  includesEdge: (edge: EdgeInfo) => boolean;
}

/**
 * Ao selecionar um nó, o resto do grafo é atenuado e só ele e seus vizinhos
 * diretos ficam em evidência. Porte de `graph-focus.js`.
 */
export function resolveGraphFocus(
  nodes: ProjectedNode[] | GraphNode[],
  edges: EdgeInfo[],
  selectedId: string | null
): GraphFocus | null {
  const id = selectedId ? String(selectedId) : null;
  const availableIds = new Set(nodes.map((node) => String(node.id)));
  if (!id || !availableIds.has(id)) return null;

  const neighborIds = new Set<string>();
  const focusedEdges = edges.filter((edge) => {
    if (edge.a !== id && edge.b !== id) return false;
    const neighborId = edge.a === id ? edge.b : edge.a;
    if (!availableIds.has(neighborId)) return false;
    neighborIds.add(neighborId);
    return true;
  });

  const nodeIds = new Set([id, ...neighborIds]);

  return {
    selectedId: id,
    nodeIds,
    neighborIds,
    edges: focusedEdges,
    includesNode: (nodeId: string) => nodeIds.has(String(nodeId)),
    includesEdge: (edge: EdgeInfo) => edge.a === id || edge.b === id
  };
}
