/**
 * @vitest-environment node
 *
 * Integridade dos modelos de nota e busca por id.
 * Garante que cada modelo tem os campos obrigatórios e que `findTemplate`
 * devolve o modelo correto ou o fallback.
 */

import { describe, expect, test } from "vitest";

import { TEMPLATE_LABELS, type TemplateId } from "@/domain/notes";
import {
  findTemplate,
  noteCompletionReadiness,
  TEMPLATE_GROUPS,
  TEMPLATES,
  type NoteTemplate
} from "./templates";
import { createNoteRecord } from "./notes";

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

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

  test("o modelo de estudo já prepara uma nota permanente para recuperação ativa", () => {
    const study = findTemplate("study");

    expect(study.kind).toBe("permanent");
    expect(study.folder).toBe("resources");
    expect(study.titlePlaceholder).toContain("pergunta");
    expect(study.content).toContain("Pergunta que esta nota responde");
    expect(study.content).toContain("Exemplo ou aplicação");
    expect(study.content).toContain("Fonte");
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

describe("noteCompletionReadiness", () => {
  test("distingue o scaffolding intacto de conteúdo realmente escrito", () => {
    const study = findTemplate("study");
    const note = createNoteRecord({
      id: "study-note",
      title: "Por que a inflação pode elevar os juros?",
      template: "study",
      content: study.content
    });

    expect(noteCompletionReadiness(note, plain)).toBe("template-scaffold");
    expect(
      noteCompletionReadiness(
        { ...note, content: "<p>Porque a política monetária tenta reduzir a demanda.</p>" },
        plain
      )
    ).toBe("ready");
  });

  test("mantém o comportamento livre das notas em branco", () => {
    const note = createNoteRecord({
      id: "blank-note",
      title: "Uma ideia suficiente",
      template: "blank",
      content: ""
    });

    expect(noteCompletionReadiness(note, plain)).toBe("ready");
    expect(
      noteCompletionReadiness({ ...note, title: "", content: "" }, plain)
    ).toBe("empty");
  });
});
