/**
 * Estimativa de retenção.
 *
 * Ebbinghaus (1885) mostrou que o esquecimento cai de forma exponencial com o
 * tempo desde a última exposição. Aqui a curva é ancorada no intervalo que o
 * SM-2 agendou: o intervalo funciona como **meia-vida**, então a estimativa
 * fica em 50% exatamente quando a revisão vence.
 *
 * Essa ligação entre intervalo e meia-vida é uma convenção deste app, não um
 * resultado da literatura — o SM-2 agenda revisões, não prevê probabilidade
 * de lembrança. Serve para dar uma leitura contínua entre uma revisão e a
 * seguinte; é indicador de apoio ao estudo, não medição de memória.
 */

import { SM2 } from "./scheduler";

export const DAY = 86_400_000;

export const policy = Object.freeze({
  /** Intervalo de partida de quem nunca foi revisado. */
  initialNoteInterval: 3,
  initialEdgeInterval: 7,
  /** Revisões repetidas dentro desta janela não contam de novo. */
  repeatWindow: 5 * 60 * 1000,
  maxInterval: SM2.maxInterval
});

export type RetentionLevel = "strong" | "medium" | "weak";

export interface RetentionItem {
  createdAt?: string;
  baselineAt?: string;
  lastReviewedAt?: string | null;
  lastReinforcedAt?: string | null;
  intervalDays?: number;
}

export function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function retention(
  item: RetentionItem | null | undefined,
  at: number = Date.now(),
  type: "note" | "edge" = "note"
): number {
  if (!item) return 0;
  const fallback =
    type === "edge" ? policy.initialEdgeInterval : policy.initialNoteInterval;
  const lastActivity =
    item.lastReviewedAt || item.lastReinforcedAt || item.baselineAt || item.createdAt;
  const elapsedDays = Math.max(0, at - Date.parse(lastActivity ?? "")) / DAY;
  const halfLife = Math.max(0.25, finite(item.intervalDays, fallback));
  return Math.max(0, Math.min(1, Math.pow(2, -elapsedDays / halfLife)));
}

export function level(value: number): RetentionLevel {
  if (value >= 0.72) return "strong";
  if (value >= 0.4) return "medium";
  return "weak";
}
