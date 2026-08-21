/**
 * Modelo de conhecimento: mantém força de retenção por nota e por conexão,
 * sincroniza com as notas do workspace e produz o snapshot que alimenta o
 * grafo, a curva e a fila de revisão.
 *
 * Porte de `src/domain/knowledge/knowledge-model.js`. A diferença de
 * contrato é que aqui as ligações vêm em `connections`, não em `links`.
 */

import { dateNotAfter, isValidDate, latestDate, safeDate } from "@/shared/dates";
import { connectionIds, normalizeConnections, type Note } from "@/domain/notes";
import { DAY, finite, level, policy, retention, type RetentionLevel } from "./retention";
import {
  SM2,
  dueDate,
  initialSchedule,
  schedule,
  type Quality,
  type ScheduleState
} from "./scheduler";

export interface ReviewEntry {
  at: string;
  quality: Quality;
  intervalBefore: number;
  intervalAfter: number;
}

export interface NoteState extends ScheduleState {
  createdAt: string;
  baselineAt: string;
  lastReviewedAt: string | null;
  /** Quando a próxima revisão vence. Nulo enquanto nunca foi revisada. */
  dueAt: string | null;
  reviewCount: number;
  history: ReviewEntry[];
}

export interface EdgeState extends ScheduleState {
  a: string;
  b: string;
  createdAt: string;
  baselineAt: string;
  lastReinforcedAt: string | null;
  reinforcementCount: number;
}

export interface KnowledgeState {
  version: 1;
  notes: Record<string, NoteState>;
  edges: Record<string, EdgeState>;
}

export interface NoteInfo extends NoteState {
  strength: number;
  level: RetentionLevel;
}

export interface EdgeInfo extends EdgeState {
  id: string;
  strength: number;
  level: RetentionLevel;
}

export interface GraphNote extends NoteInfo {
  id: string;
  title: string;
  folder: string;
  kind: Note["kind"];
  status: Note["status"];
  connections: string[];
  updatedAt: string;
}

export interface KnowledgeSnapshot {
  at: string;
  notes: GraphNote[];
  edges: EdgeInfo[];
  metrics: {
    /** Nulo quando ainda não existe nenhuma nota elegível para revisão. */
    average: number | null;
    strongEdges: number;
    mediumEdges: number;
    weakEdges: number;
    reviewDue: number;
  };
}

export interface CurvePoint {
  at: string;
  value: number | null;
}

export type ReviewResult =
  | { ok: false; reason: "missing" | "ineligible" }
  | { ok: true; repeated: true; note: NoteInfo | null }
  | { ok: true; repeated: false; reinforcedEdges: number; note: NoteInfo | null };

export function isReviewEligible(note: Pick<Note, "kind" | "status">): boolean {
  return note.status === "saved" && note.kind !== "fleeting";
}

export function isReviewDue(
  note: Pick<GraphNote, "kind" | "status" | "dueAt" | "strength">,
  at: number = Date.now()
): boolean {
  if (!isReviewEligible(note)) return false;
  return note.dueAt ? Date.parse(note.dueAt) <= at : note.strength < 0.55;
}

function emptyState(): KnowledgeState {
  return { version: 1, notes: {}, edges: {} };
}

/** Aresta é sem direção: o id canônico ordena os dois extremos. */
export function canonicalEdgeId(a: string, b: string): string {
  return [String(a), String(b)].sort((left, right) => left.localeCompare(right)).join("::");
}

function normalizeReview(item: unknown): ReviewEntry | null {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  if (!isValidDate(source.at)) return null;
  const quality = Math.max(0, Math.min(5, Math.round(finite(source.quality, 4)))) as Quality;
  return {
    at: source.at,
    quality,
    // `stability*` são os nomes que o histórico usava antes do SM-2.
    intervalBefore: Math.max(
      0.25,
      finite(source.intervalBefore ?? source.stabilityBefore, policy.initialNoteInterval)
    ),
    intervalAfter: Math.max(
      0.25,
      finite(source.intervalAfter ?? source.stabilityAfter, policy.initialNoteInterval)
    )
  };
}

/**
 * Lê os campos do SM-2 aceitando o formato anterior, em que só havia
 * `stabilityDays`. O intervalo herda aquele valor e o fator de facilidade
 * começa no padrão, porque a qualidade das revisões passadas não foi
 * registrada — não dá para reconstruir o que nunca foi perguntado.
 */
function readSchedule(
  item: Record<string, unknown>,
  fallbackInterval: number
): ScheduleState {
  return {
    easeFactor: Math.max(SM2.minEase, finite(item.easeFactor, SM2.initialEase)),
    repetitions: Math.max(0, Math.floor(finite(item.repetitions, 0))),
    intervalDays: Math.min(
      SM2.maxInterval,
      Math.max(0.25, finite(item.intervalDays ?? item.stabilityDays, fallbackInterval))
    )
  };
}

export function normalizeKnowledgeState(source: unknown): KnowledgeState {
  const normalized = emptyState();
  if (!source || typeof source !== "object") return normalized;
  const raw = source as Record<string, unknown>;

  Object.entries((raw.notes ?? {}) as Record<string, unknown>).forEach(([id, value]) => {
    if (!id || !value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    normalized.notes[id] = {
      createdAt: safeDate(item.createdAt),
      baselineAt: safeDate(item.baselineAt || item.lastReviewedAt || item.createdAt),
      lastReviewedAt: isValidDate(item.lastReviewedAt) ? item.lastReviewedAt : null,
      dueAt: isValidDate(item.dueAt) ? item.dueAt : null,
      ...readSchedule(item, policy.initialNoteInterval),
      reviewCount: Math.max(0, Math.floor(finite(item.reviewCount, 0))),
      history: Array.isArray(item.history)
        ? item.history.map(normalizeReview).filter((entry): entry is ReviewEntry => entry !== null).slice(-500)
        : []
    };
  });

  Object.values((raw.edges ?? {}) as Record<string, unknown>).forEach((value) => {
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (!item.a || !item.b || item.a === item.b) return;
    const id = canonicalEdgeId(String(item.a), String(item.b));
    normalized.edges[id] = {
      a: String(item.a),
      b: String(item.b),
      createdAt: safeDate(item.createdAt),
      baselineAt: safeDate(item.baselineAt || item.lastReinforcedAt || item.createdAt),
      lastReinforcedAt: isValidDate(item.lastReinforcedAt) ? item.lastReinforcedAt : null,
      ...readSchedule(item, policy.initialEdgeInterval),
      reinforcementCount: Math.max(0, Math.floor(finite(item.reinforcementCount, 0)))
    };
  });

  return normalized;
}

export function createKnowledgeModel(initialState: unknown = null) {
  let state = normalizeKnowledgeState(initialState);
  let noteIndex = new Map<string, Note>();

  /**
   * Cria o estado de notas e arestas que ainda não existem e descarta o que
   * deixou de existir. Notas e conexões novas entram com a estabilidade
   * inicial, ancoradas na data de atualização.
   */
  function sync(notes: Note[], at: number = Date.now()): KnowledgeSnapshot {
    const list = Array.isArray(notes) ? notes : [];
    const previousNoteIndex = noteIndex;
    noteIndex = new Map(list.map((note) => [String(note.id), note]));
    const validIds = new Set(noteIndex.keys());

    list.forEach((note) => {
      const id = String(note.id);
      const existing = state.notes[id];
      if (existing) {
        const previous = previousNoteIndex.get(id);
        const becameReviewEligible =
          previous &&
          !isReviewEligible(previous) &&
          isReviewEligible(note);

        /*
         * Captura e autoria podem acontecer dias antes da conclusão. Uma nota
         * nunca revisada começa a esquecer quando se torna revisável, não
         * quando o primeiro rascunho foi salvo. Histórico existente jamais é
         * reiniciado por uma troca posterior de estágio.
         */
        if (
          becameReviewEligible &&
          existing.reviewCount === 0 &&
          !existing.lastReviewedAt &&
          existing.history.length === 0
        ) {
          existing.baselineAt = dateNotAfter(note.updatedAt || note.createdAt, at);
          existing.dueAt = null;
          Object.assign(existing, initialSchedule(policy.initialNoteInterval));
        }
        return;
      }
      state.notes[id] = {
        createdAt: dateNotAfter(note.createdAt, at),
        baselineAt: dateNotAfter(note.updatedAt || note.createdAt, at),
        lastReviewedAt: null,
        dueAt: null,
        ...initialSchedule(policy.initialNoteInterval),
        reviewCount: 0,
        history: []
      };
    });

    Object.keys(state.notes).forEach((id) => {
      if (!validIds.has(id)) delete state.notes[id];
    });

    const liveEdges = new Set<string>();
    list.forEach((source) => {
      // As conexões carregam motivo; aqui só interessa o destino.
      connectionIds(normalizeConnections(source.connections)).forEach((targetId) => {
        const target = noteIndex.get(targetId);
        if (!target || String(source.id) === targetId) return;
        const id = canonicalEdgeId(String(source.id), targetId);
        liveEdges.add(id);
        if (state.edges[id]) return;
        const [a, b] = [String(source.id), targetId].sort((left, right) =>
          left.localeCompare(right)
        );
        state.edges[id] = {
          a,
          b,
          createdAt: dateNotAfter(latestDate(source.createdAt, target.createdAt), at),
          baselineAt: dateNotAfter(
            latestDate(source.updatedAt, target.updatedAt, source.createdAt, target.createdAt),
            at
          ),
          lastReinforcedAt: null,
          ...initialSchedule(policy.initialEdgeInterval),
          reinforcementCount: 0
        };
      });
    });

    Object.keys(state.edges).forEach((id) => {
      if (!liveEdges.has(id)) delete state.edges[id];
    });

    return snapshot(at);
  }

  function noteInfo(id: string, at: number = Date.now()): NoteInfo | null {
    const item = state.notes[String(id)];
    if (!item) return null;
    const strength = retention(item, at, "note");
    return { ...item, strength, level: level(strength) };
  }

  function edgeInfo(id: string, at: number = Date.now()): EdgeInfo | null {
    const item = state.edges[id];
    if (!item) return null;
    const strength = retention(item, at, "edge");
    return { ...item, id, strength, level: level(strength) };
  }

  function snapshot(at: number = Date.now()): KnowledgeSnapshot {
    const notes = [...noteIndex.values()].map((note) => {
      const info = noteInfo(note.id, at);
      return {
        id: String(note.id),
        title: String(note.title),
        folder: String(note.folder || "inbox"),
        kind: note.kind,
        status: note.status,
        connections: connectionIds(normalizeConnections(note.connections)),
        updatedAt: safeDate(note.updatedAt || note.createdAt),
        ...(info as NoteInfo)
      } as GraphNote;
    });

    const edges = Object.keys(state.edges)
      .map((id) => edgeInfo(id, at))
      .filter((edge): edge is EdgeInfo => edge !== null);

    const reviewableNotes = notes.filter(isReviewEligible);
    const average = reviewableNotes.length
      ? reviewableNotes.reduce((sum, note) => sum + note.strength, 0) /
        reviewableNotes.length
      : null;

    return {
      at: new Date(at).toISOString(),
      notes,
      edges,
      metrics: {
        average,
        strongEdges: edges.filter((edge) => edge.level === "strong").length,
        mediumEdges: edges.filter((edge) => edge.level === "medium").length,
        weakEdges: edges.filter((edge) => edge.level === "weak").length,
        /* Vencidas de fato: nunca revisadas contam quando a estimativa cai. */
        reviewDue: notes.filter((note) => isReviewDue(note, at)).length
      }
    };
  }

  /**
   * Aplica uma revisão com a qualidade informada e reagenda a nota pelo SM-2.
   *
   * As conexões ligadas recebem a mesma qualidade. Isso é uma aproximação
   * deliberada: a pessoa avaliou a ideia, não cada link individualmente, mas
   * como cada conexão guarda um motivo escrito, lembrar da ideia normalmente
   * envolve lembrar por que ela se liga às vizinhas.
   */
  function reviewNote(
    id: string,
    quality: Quality = 4,
    at: string = new Date().toISOString()
  ): ReviewResult {
    const key = String(id);
    const item = state.notes[key];
    if (!item || !isValidDate(at)) return { ok: false, reason: "missing" };
    const source = noteIndex.get(key);
    if (!source || !isReviewEligible(source)) return { ok: false, reason: "ineligible" };

    if (
      item.lastReviewedAt &&
      Date.parse(at) - Date.parse(item.lastReviewedAt) < policy.repeatWindow
    ) {
      return { ok: true, repeated: true, note: noteInfo(key) };
    }

    const intervalBefore = item.intervalDays;
    const next = schedule(item, quality);

    item.easeFactor = next.easeFactor;
    item.repetitions = next.repetitions;
    item.intervalDays = next.intervalDays;
    item.lastReviewedAt = at;
    item.dueAt = dueDate(at, next.intervalDays);
    item.reviewCount += 1;
    item.history = [
      ...item.history,
      { at, quality, intervalBefore, intervalAfter: next.intervalDays }
    ].slice(-500);

    let reinforcedEdges = 0;
    Object.values(state.edges).forEach((edge) => {
      if (edge.a !== key && edge.b !== key) return;
      const edgeNext = schedule(edge, quality);
      edge.easeFactor = edgeNext.easeFactor;
      edge.repetitions = edgeNext.repetitions;
      edge.intervalDays = edgeNext.intervalDays;
      edge.lastReinforcedAt = at;
      edge.reinforcementCount += 1;
      reinforcedEdges += 1;
    });

    return { ok: true, repeated: false, reinforcedEdges, note: noteInfo(key) };
  }

  /** Intervalos que cada resposta produziria, para a interface antecipar. */
  function previewFor(id: string, qualities: Quality[]): Record<number, number> {
    const item = state.notes[String(id)];
    if (!item) return {};
    return Object.fromEntries(
      qualities.map((quality) => [quality, schedule(item, quality).intervalDays])
    );
  }

  /** Retenção reconstruída para um instante passado, usando o histórico. */
  function retentionAt(noteId: string, at: number): number {
    const item = state.notes[noteId];
    if (!item) return 0;
    const history = item.history
      .filter((review) => Date.parse(review.at) <= at)
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    const latestReview = history[history.length - 1];
    const baseline = Date.parse(item.baselineAt) <= at ? item.baselineAt : item.createdAt;
    return retention(
      {
        baselineAt: latestReview?.at || baseline,
        intervalDays: latestReview?.intervalAfter || policy.initialNoteInterval
      },
      at,
      "note"
    );
  }

  function curve(days: number | "all" = 30, now: number = Date.now()): CurvePoint[] {
    const indexedNotes = [...noteIndex.values()]
      .filter(isReviewEligible)
      .map((note) => ({
        id: String(note.id),
        startedAt: state.notes[String(note.id)]?.baselineAt
      }));
    const oldest =
      indexedNotes
        .map((note) => Date.parse(note.startedAt ?? ""))
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0] || now;
    const requested =
      days === "all"
        ? Math.max(1, Math.ceil((now - oldest) / DAY))
        : Math.max(1, Number(days) || 30);
    const span = Math.min(policy.maxInterval, requested);

    const points: CurvePoint[] = [];
    for (let offset = span; offset >= 0; offset -= 1) {
      const time = now - offset * DAY;
      const active = indexedNotes.filter((note) => Date.parse(note.startedAt ?? "") <= time);
      const value = active.length
        ? active.reduce((sum, note) => sum + retentionAt(note.id, time), 0) / active.length
        : null;
      points.push({ at: new Date(time).toISOString(), value });
    }
    return points;
  }

  function exportState(): KnowledgeState {
    return JSON.parse(JSON.stringify(state));
  }

  function importState(source: unknown, merge = false): KnowledgeSnapshot {
    const incoming = normalizeKnowledgeState(source);
    state = merge
      ? normalizeKnowledgeState({
          version: 1,
          notes: { ...state.notes, ...incoming.notes },
          edges: { ...state.edges, ...incoming.edges }
        })
      : incoming;
    return snapshot();
  }

  return {
    sync,
    snapshot,
    curve,
    noteInfo,
    edgeInfo,
    reviewNote,
    previewFor,
    exportState,
    importState,
    canonicalEdgeId,
    constants: policy
  };
}

export type KnowledgeModel = ReturnType<typeof createKnowledgeModel>;
