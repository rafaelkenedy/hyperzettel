/**
 * @vitest-environment node
 *
 * Utilitários de data do modelo de conhecimento.
 * Testa os quatro cenários que o domínio usa: validação, fallback, teto e
 * escolha da mais recente.
 */

import { describe, expect, test } from "vitest";

import { dateNotAfter, isValidDate, latestDate, safeDate } from "./dates";

describe("isValidDate", () => {
  test("aceita ISO válida", () => {
    expect(isValidDate("2026-01-01T00:00:00.000Z")).toBe(true);
  });

  test("rejeita string não-data", () => {
    expect(isValidDate("nope")).toBe(false);
  });

  test("rejeita valores que não são string", () => {
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
    expect(isValidDate(42)).toBe(false);
  });
});

describe("safeDate", () => {
  test("devolve a data quando é válida", () => {
    expect(safeDate("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  test("usa o fallback quando inválida", () => {
    const fallback = "2020-01-01T00:00:00.000Z";
    expect(safeDate("lixo", fallback)).toBe(fallback);
  });

  test("usa o fallback para valores não-string", () => {
    const fallback = "2020-01-01T00:00:00.000Z";
    expect(safeDate(undefined, fallback)).toBe(fallback);
    expect(safeDate(null, fallback)).toBe(fallback);
  });
});

describe("dateNotAfter", () => {
  const ceiling = Date.parse("2026-06-01T00:00:00.000Z");

  test("preserva data anterior ao teto", () => {
    const past = "2026-01-01T00:00:00.000Z";
    expect(dateNotAfter(past, ceiling)).toBe(past);
  });

  test("limita data posterior ao teto", () => {
    const future = "2027-01-01T00:00:00.000Z";
    const result = dateNotAfter(future, ceiling);
    expect(Date.parse(result)).toBe(ceiling);
  });

  test("trata valor inválido usando fallback de safeDate", () => {
    const result = dateNotAfter("lixo", ceiling);
    expect(Date.parse(result)).toBeLessThanOrEqual(ceiling);
  });
});

describe("latestDate", () => {
  test("devolve a mais recente entre várias datas", () => {
    expect(
      latestDate(
        "2026-01-01T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z",
        "2026-03-01T00:00:00.000Z"
      )
    ).toBe("2026-06-01T00:00:00.000Z");
  });

  test("ignora valores inválidos", () => {
    expect(latestDate(null, "2026-01-01T00:00:00.000Z", undefined)).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });

  test("devolve now quando tudo é inválido", () => {
    const before = Date.now();
    const result = latestDate(null, undefined, "lixo");
    const after = Date.now();
    const parsed = Date.parse(result);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});
