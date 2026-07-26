/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createNoteRecord, type Relation } from "@/domain/notes";
import { StructureConnections } from "./StructureConnections";

const mocks = vi.hoisted(() => ({
  draft: null as unknown as ReturnType<typeof createNoteRecord>,
  relations: [] as Relation[],
  openNote: vi.fn()
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => mocks
}));

afterEach(() => {
  cleanup();
  mocks.openNote.mockReset();
});

test("mostra as notas ligadas à estrutura com seus motivos", () => {
  mocks.draft = createNoteRecord({ id: "map", title: "Mapa", kind: "structure" });
  mocks.relations = [
    {
      note: createNoteRecord({ id: "idea", title: "Juros sobre juros", kind: "permanent" }),
      direction: "incoming",
      reason: "",
      incomingReason: "Explica o mecanismo central."
    }
  ];

  render(<StructureConnections />);

  expect(screen.getByText("1 ideia conectada")).toBeTruthy();
  expect(screen.getByText("Explica o mecanismo central.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Juros sobre juros" }));
  expect(mocks.openNote).toHaveBeenCalledWith("idea");
});

test("não ocupa o editor de notas que não são estruturas", () => {
  mocks.draft = createNoteRecord({ id: "idea", kind: "permanent" });
  mocks.relations = [];

  const { container } = render(<StructureConnections />);
  expect(container.childElementCount).toBe(0);
});
