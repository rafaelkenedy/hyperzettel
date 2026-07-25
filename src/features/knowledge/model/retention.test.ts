/**
 * @vitest-environment node
 *
 * Curva de retenção e classificação de nível.
 * Verifica a forma exponencial, os limiares e os casos de borda.
 */

import { describe, expect, test } from "vitest";

import { DAY, finite, level, policy, retention, type RetentionItem } from "./retention";

describe("finite", () => {
  test("devolve o número quando é finito", () => {
    expect(finite(42, 0)).toBe(42);
    expect(finite(-1, 0)).toBe(-1);
  });

  test("usa o fallback para NaN, Infinity e não-número", () => {
    expect(finite(NaN, 7)).toBe(7);
    expect(finite(Infinity, 7)).toBe(7);
    expect(finite("abc", 7)).toBe(7);
    expect(finite(undefined, 7)).toBe(7);
  });
});

describe("retention", () => {
  const now = Date.parse("2026-06-15T12:00:00.000Z");

  function item(overrides: Partial<RetentionItem> = {}): RetentionItem {
    return {
      baselineAt: new Date(now).toISOString(),
      intervalDays: policy.initialNoteInterval,
      ...overrides
    };
  }

  test("é 1.0 logo após a baseline", () => {
    expect(retention(item(), now, "note")).toBeCloseTo(1.0, 2);
  });

  test("é ~0.5 quando o tempo decorrido iguala o intervalo (meia-vida)", () => {
    const elapsed = now + policy.initialNoteInterval * DAY;
    expect(retention(item(), elapsed, "note")).toBeCloseTo(0.5, 1);
  });

  test("cai para perto de zero com o tempo muito longo", () => {
    const far = now + 365 * DAY;
    expect(retention(item(), far, "note")).toBeLessThan(0.01);
  });

  test("devolve 0 para item nulo", () => {
    expect(retention(null, now)).toBe(0);
    expect(retention(undefined, now)).toBe(0);
  });

  test("usa o intervalo de aresta quando type é edge", () => {
    const edgeItem = item({ intervalDays: undefined });
    const atEdgeHalfLife = now + policy.initialEdgeInterval * DAY;
    expect(retention(edgeItem, atEdgeHalfLife, "edge")).toBeCloseTo(0.5, 1);
  });

  test("garante que o intervalo mínimo é 0.25 dias", () => {
    const tiny = item({ intervalDays: 0 });
    // Não deve dar NaN nem Infinity
    expect(Number.isFinite(retention(tiny, now + DAY, "note"))).toBe(true);
  });
});

describe("level", () => {
  test("classifica corretamente nos três faixas", () => {
    expect(level(0.9)).toBe("strong");
    expect(level(0.72)).toBe("strong");
    expect(level(0.5)).toBe("medium");
    expect(level(0.4)).toBe("medium");
    expect(level(0.39)).toBe("weak");
    expect(level(0)).toBe("weak");
  });
});
