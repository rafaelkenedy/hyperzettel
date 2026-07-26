import { describe, expect, test } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import {
  createGuidedTopicDraft,
  normalizeGuidedSubject,
  progressiveNavigationFor
} from "./guidedOnboarding";

describe("onboarding guiado", () => {
  test("normaliza o assunto e cria uma estrutura sem interpolar HTML do usuário", () => {
    const subject = "  Inflação   <script>alert(1)</script>  ";
    const draft = createGuidedTopicDraft(subject);

    expect(draft.title).toBe("Inflação <script>alert(1)</script>");
    expect(draft.kind).toBe("structure");
    expect(draft.folder).toBe("resources");
    expect(draft.content).not.toContain("<script>");
    expect(draft.content).toContain("Próxima nota");
  });

  test("limita assuntos e rejeita entradas vazias", () => {
    expect(normalizeGuidedSubject(`  ${"a".repeat(140)}  `)).toHaveLength(120);
    expect(() => createGuidedTopicDraft("  a ")).toThrow(
      "Informe um assunto com pelo menos três caracteres."
    );
  });

  test("libera a navegação somente quando o conteúdo a torna útil", () => {
    const structure = createNoteRecord({
      id: "structure",
      title: "Mapa",
      folder: "resources",
      kind: "structure",
      status: "draft"
    });
    const capture = createNoteRecord({
      id: "capture",
      title: "Captura",
      folder: "inbox",
      kind: "fleeting",
      status: "saved",
      connections: [{ id: structure.id, reason: "Responde à pergunta central." }]
    });

    expect(progressiveNavigationFor([])).toEqual({
      folderIds: [],
      kindIds: [],
      showProcess: false,
      showMap: false,
      showReview: false
    });
    expect(progressiveNavigationFor([structure, capture])).toEqual({
      folderIds: ["resources"],
      kindIds: ["fleeting", "structure"],
      showProcess: true,
      showMap: true,
      showReview: false
    });
    expect(
      progressiveNavigationFor([{ ...structure, status: "saved" }]).showReview
    ).toBe(true);
  });
});
