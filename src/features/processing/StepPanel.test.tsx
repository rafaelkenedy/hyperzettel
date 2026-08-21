/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import { StepPanel } from "./StepPanel";

const mocks = vi.hoisted(() => ({
  openNote: vi.fn()
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({
    openNote: mocks.openNote
  })
}));

beforeEach(() => {
  mocks.openNote.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

test("prepara a nota para conectar sem sair do processamento", async () => {
  const note = createNoteRecord({
    id: "capture",
    title: "Minha ideia",
    kind: "permanent",
    folder: "resources"
  });
  const openPicker = vi.fn();

  render(
    <StepPanel
      note={note}
      sections={[]}
      step="connect"
      onStep={vi.fn()}
      onComplete={vi.fn()}
      onSkip={vi.fn()}
      onOpenPicker={openPicker}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: /Conectar a outras notas/ }));

  await waitFor(() =>
    expect(mocks.openNote).toHaveBeenCalledWith("capture", { navigate: false })
  );
  expect(openPicker).toHaveBeenCalledOnce();
});
