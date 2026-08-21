import { describe, expect, test } from "vitest";

import { selectInitialNoteId } from "./noteSession";

const notes = [{ id: "a" }, { id: "b" }];

describe("selectInitialNoteId", () => {
  test("não tenta restaurar o rascunho em memória num vault vazio", () => {
    expect(selectInitialNoteId([], "", "rascunho-nao-persistido")).toBeNull();
  });

  test("ignora um id de sessão que já não existe no índice", () => {
    expect(selectInitialNoteId(notes, "", "removida")).toBeNull();
  });

  test("restaura a nota de sessão quando ela ainda existe", () => {
    expect(selectInitialNoteId(notes, "", "b")).toBe("b");
  });

  test("um hash válido tem prioridade sobre a sessão", () => {
    expect(selectInitialNoteId(notes, "a", "b")).toBe("a");
  });

  test("hash obsoleto ou #novo não abre outra nota silenciosamente", () => {
    expect(selectInitialNoteId(notes, "removida", "b")).toBeNull();
    expect(selectInitialNoteId(notes, "novo", "b")).toBeNull();
  });
});
