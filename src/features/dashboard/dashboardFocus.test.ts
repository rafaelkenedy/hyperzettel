import { describe, expect, test } from "vitest";

import { selectDashboardFocus } from "./dashboardFocus";

describe("selectDashboardFocus", () => {
  test("mantém uma etapa incompleta acima do trabalho recorrente", () => {
    expect(
      selectDashboardFocus({
        firstCycleStage: "connect",
        reviewDue: 2,
        inboxCount: 3
      })
    ).toBe("connect");
  });

  test("devolve a prioridade diária depois que o primeiro ciclo termina", () => {
    expect(
      selectDashboardFocus({
        firstCycleStage: "complete",
        reviewDue: 2,
        inboxCount: 3
      })
    ).toBe("review");
    expect(
      selectDashboardFocus({
        firstCycleStage: "complete",
        reviewDue: 0,
        inboxCount: 3
      })
    ).toBe("inbox");
    expect(
      selectDashboardFocus({
        firstCycleStage: "complete",
        reviewDue: 0,
        inboxCount: 0
      })
    ).toBe("complete");
  });

  test("usa as mesmas prioridades quando não existe onboarding ativo", () => {
    expect(selectDashboardFocus({ reviewDue: 1, inboxCount: 2 })).toBe("review");
    expect(selectDashboardFocus({ reviewDue: 0, inboxCount: 2 })).toBe("inbox");
    expect(selectDashboardFocus({ reviewDue: 0, inboxCount: 0 })).toBe("clear");
  });
});
