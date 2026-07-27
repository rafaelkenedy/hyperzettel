import { describe, expect, test } from "vitest";

import {
  NOTE_UI_LABELS,
  resolveCompletionAction,
  resolveNoteUiState
} from "./noteUiState";

describe("resolveNoteUiState", () => {
  test.each([
    [
      "updating",
      { saving: true, dirty: true, status: "draft" as const, hasPersistedNote: false }
    ],
    [
      "autosave-pending",
      { saving: false, dirty: true, status: "saved" as const, hasPersistedNote: true }
    ],
    [
      "new-draft",
      { saving: false, dirty: false, status: "draft" as const, hasPersistedNote: false }
    ],
    [
      "draft-in-vault",
      { saving: false, dirty: false, status: "draft" as const, hasPersistedNote: true }
    ],
    [
      "ready",
      { saving: false, dirty: false, status: "saved" as const, hasPersistedNote: true }
    ]
  ])("resolve %s", (expected, input) => {
    expect(resolveNoteUiState(input)).toBe(expected);
    expect(NOTE_UI_LABELS[expected]).toBeTruthy();
  });
});

describe("resolveCompletionAction", () => {
  test("conclui um rascunho que já existe no vault", () => {
    expect(
      resolveCompletionAction({
        dirty: false,
        status: "draft",
        hasPersistedNote: true,
        shortcut: "Ctrl+S",
        readiness: "ready"
      })
    ).toEqual({ enabled: true, label: "Concluir nota (Ctrl+S)" });
  });

  test("não oferece conclusão para um rascunho novo e vazio", () => {
    expect(
      resolveCompletionAction({
        dirty: false,
        status: "draft",
        hasPersistedNote: false,
        shortcut: "Ctrl+S",
        readiness: "empty"
      })
    ).toEqual({ enabled: false, label: "Escreva antes de concluir" });
  });

  test("aplica imediatamente alterações de uma nota pronta", () => {
    expect(
      resolveCompletionAction({
        dirty: true,
        status: "saved",
        hasPersistedNote: true,
        shortcut: "Ctrl+S",
        readiness: "ready"
      })
    ).toEqual({ enabled: true, label: "Aplicar alterações agora (Ctrl+S)" });
  });

  test("não conclui um modelo que ainda contém apenas as instruções", () => {
    expect(
      resolveCompletionAction({
        dirty: true,
        status: "draft",
        hasPersistedNote: false,
        shortcut: "Ctrl+S",
        readiness: "template-scaffold"
      })
    ).toEqual({ enabled: false, label: "Preencha o modelo antes de concluir" });
  });
});
