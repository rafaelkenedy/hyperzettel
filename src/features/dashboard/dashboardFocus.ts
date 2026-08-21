import type { FirstCycleStage } from "@/features/onboarding/guidedOnboarding";

export type DashboardFocusKind =
  | FirstCycleStage
  | "review"
  | "inbox"
  | "clear";

/**
 * Escolhe a única ação principal da home.
 *
 * Etapas ainda incompletas ensinam o primeiro ciclo. Depois da conclusão, o
 * trabalho recorrente volta a mandar: revisões vencidas, entrada e somente
 * então a celebração do marco.
 */
export function selectDashboardFocus(input: {
  firstCycleStage?: FirstCycleStage;
  reviewDue: number;
  inboxCount: number;
}): DashboardFocusKind {
  const { firstCycleStage, reviewDue, inboxCount } = input;

  if (firstCycleStage && firstCycleStage !== "complete") return firstCycleStage;
  if (reviewDue > 0) return "review";
  if (inboxCount > 0) return "inbox";
  if (firstCycleStage === "complete") return "complete";
  return "clear";
}
