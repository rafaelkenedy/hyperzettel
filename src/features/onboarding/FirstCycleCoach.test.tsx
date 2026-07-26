/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createNoteRecord, type Note } from "@/domain/notes";
import { FirstCycleCoach } from "./FirstCycleCoach";

const mocks = vi.hoisted(() => ({
  notes: [] as Note[],
  draft: null as unknown as Note,
  newNote: vi.fn(),
  persistDraft: vi.fn(),
  setView: vi.fn(),
  toggleMap: vi.fn()
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({
    notes: mocks.notes,
    draft: mocks.draft,
    newNote: mocks.newNote,
    persistDraft: mocks.persistDraft
  })
}));

vi.mock("@/app/providers/NavigationProvider", () => ({
  useNavigation: () => ({
    setView: mocks.setView,
    toggleMap: mocks.toggleMap
  })
}));

beforeEach(() => {
  mocks.newNote.mockReset().mockResolvedValue(undefined);
  mocks.persistDraft.mockReset().mockResolvedValue(createNoteRecord({ id: "capture" }));
  mocks.setView.mockReset();
  mocks.toggleMap.mockReset();
});

afterEach(cleanup);

describe("FirstCycleCoach", () => {
  test("oferece a primeira captura depois do mapa", () => {
    const structure = createNoteRecord({ id: "map", kind: "structure" });
    mocks.notes = [structure];
    mocks.draft = structure;

    render(<FirstCycleCoach />);
    fireEvent.click(screen.getByRole("button", { name: "Criar primeira captura" }));

    expect(mocks.newNote).toHaveBeenCalledOnce();
  });

  test("persiste a captura antes de abrir o processamento", async () => {
    const structure = createNoteRecord({ id: "map", kind: "structure" });
    const capture = createNoteRecord({ id: "capture", kind: "fleeting", status: "draft" });
    mocks.notes = [structure, capture];
    mocks.draft = capture;

    render(<FirstCycleCoach />);
    fireEvent.click(screen.getByRole("button", { name: "Processar captura" }));

    await waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledOnce());
    expect(mocks.setView).toHaveBeenCalledWith("process");
  });
});
