import { expect, test } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import { selectProcessNote } from "./useProcessQueue";

test("mantém a nota ativa depois que ela é promovida e sai da fila", () => {
  const capture = createNoteRecord({
    id: "capture",
    title: "Ideia",
    kind: "fleeting",
    folder: "inbox"
  });
  const promoted = { ...capture, kind: "permanent" as const, folder: "resources" as const };

  expect(selectProcessNote([capture], [capture], "capture", new Set())?.kind).toBe(
    "fleeting"
  );
  expect(selectProcessNote([], [promoted], "capture", new Set())?.kind).toBe(
    "permanent"
  );
});

test("avança para a próxima nota quando a ativa foi removida", () => {
  const next = createNoteRecord({ id: "next", title: "Próxima" });
  expect(selectProcessNote([next], [next], "removed", new Set())?.id).toBe("next");
});
