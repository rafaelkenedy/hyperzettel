/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { GuidedStart } from "./GuidedStart";

const mocks = vi.hoisted(() => ({
  startGuidedTopic: vi.fn(),
  newNote: vi.fn()
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => mocks
}));

beforeEach(() => {
  mocks.startGuidedTopic.mockReset().mockResolvedValue(undefined);
  mocks.newNote.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("GuidedStart", () => {
  test("cria o mapa usando o assunto normalizado", async () => {
    render(<GuidedStart />);

    fireEvent.change(screen.getByLabelText("Assunto que você quer desenvolver"), {
      target: { value: "  Como   funcionam juros  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar meu mapa" }));

    await waitFor(() =>
      expect(mocks.startGuidedTopic).toHaveBeenCalledWith("Como funcionam juros")
    );
  });

  test("não avança com um assunto vazio e mantém a alternativa livre", () => {
    render(<GuidedStart />);

    fireEvent.click(screen.getByRole("button", { name: "Criar meu mapa" }));
    expect(screen.getByRole("alert").textContent).toContain("pelo menos três");
    expect(mocks.startGuidedTopic).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Prefiro começar com uma nota em branco" }));
    expect(mocks.newNote).toHaveBeenCalledOnce();
  });
});
