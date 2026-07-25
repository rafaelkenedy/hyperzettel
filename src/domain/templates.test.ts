/**
 * @vitest-environment node
 *
 * Integridade dos modelos de nota e busca por id.
 * Garante que cada modelo tem os campos obrigatórios e que `findTemplate`
 * devolve o modelo correto ou o fallback.
 */

import { describe, expect, test } from "vitest";

import { TEMPLATE_LABELS, type TemplateId } from "@/domain/notes";
import { findTemplate, TEMPLATE_GROUPS, TEMPLATES, type NoteTemplate } from "./templates";

const TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as TemplateId[];

describe("TEMPLATES", () => {
  test("todo TemplateId declarado no domínio tem um registro correspondente", () => {
    const registeredIds = TEMPLATES.map((template) => template.id);
    TEMPLATE_IDS.forEach((id) => {
      expect(registeredIds).toContain(id);
    });
  });

  test("cada modelo tem os campos obrigatórios preenchidos", () => {
    TEMPLATES.forEach((template: NoteTemplate) => {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.content).toBeTruthy();
      expect(template.folder).toBeTruthy();
      expect(template.kind).toBeTruthy();
      expect(template.group).toBeTruthy();
    });
  });

  test("cada grupo referenciado existe em TEMPLATE_GROUPS", () => {
    const validGroups = Object.keys(TEMPLATE_GROUPS);
    TEMPLATES.forEach((template) => {
      expect(validGroups).toContain(template.group);
    });
  });
});

describe("findTemplate", () => {
  test("devolve o modelo pelo id", () => {
    expect(findTemplate("concept").id).toBe("concept");
    expect(findTemplate("daily").id).toBe("daily");
  });

  test("devolve o primeiro modelo quando o id não existe", () => {
    const fallback = findTemplate("inexistente" as TemplateId);
    expect(fallback.id).toBe(TEMPLATES[0].id);
  });
});
