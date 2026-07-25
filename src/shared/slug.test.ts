import { describe, expect, test } from "vitest";

import { slugify } from "./slug";

describe("slugify", () => {
  test("remove acentos e normaliza para minúsculas com hífens", () => {
    expect(slugify("Olá, Mundo!")).toBe("ola-mundo");
  });

  test("colapsa separadores e apara hífens das pontas", () => {
    expect(slugify("  --Nota   de___teste--  ")).toBe("nota-de-teste");
  });

  test("cai no fallback quando não sobra nada", () => {
    expect(slugify("")).toBe("sem-titulo");
    expect(slugify("!!!")).toBe("sem-titulo");
    expect(slugify("###", "vazio")).toBe("vazio");
  });

  test("limita o comprimento a 48 caracteres", () => {
    expect(slugify("a".repeat(80)).length).toBe(48);
  });
});
