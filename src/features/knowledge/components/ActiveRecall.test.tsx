// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./ReviewGrades", () => ({
  ReviewGrades: ({ noteId }: { noteId: string }) => (
    <div data-testid="review-grades">Avaliar {noteId}</div>
  )
}));

import { ActiveRecall } from "./ActiveRecall";

afterEach(cleanup);

describe("ActiveRecall", () => {
  test("oculta resposta e avaliação até o usuário revelar a nota", () => {
    render(
      <ActiveRecall
        noteId="note-1"
        title="Prática de recuperação"
        content="<p>Tentar lembrar fortalece a recuperação futura.</p>"
        recallPrompt="Por que tentar lembrar é diferente de reler?"
      />
    );

    expect(screen.getByText("Por que tentar lembrar é diferente de reler?")).toBeTruthy();
    expect(screen.queryByText(/fortalece a recuperação futura/)).toBeNull();
    expect(screen.queryByTestId("review-grades")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revelar nota" }));

    expect(screen.getByText("Tentar lembrar fortalece a recuperação futura.")).toBeTruthy();
    expect(screen.getByTestId("review-grades").textContent).toContain("note-1");
  });

  test("esconde novamente a resposta ao trocar de nota", () => {
    const { rerender } = render(
      <ActiveRecall noteId="note-1" title="Primeira" content="<p>Resposta um.</p>" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Revelar nota" }));
    expect(screen.getByText("Resposta um.")).toBeTruthy();

    rerender(<ActiveRecall noteId="note-2" title="Segunda" content="<p>Resposta dois.</p>" />);

    expect(screen.queryByText("Resposta dois.")).toBeNull();
    expect(screen.getByRole("button", { name: "Revelar nota" })).toBeTruthy();
  });

  test("usa o título como pergunta quando a nota não define uma", () => {
    render(<ActiveRecall noteId="note-1" title="Intercalar assuntos" content="Resposta." />);

    expect(screen.getByText(/O que você consegue explicar sobre “Intercalar assuntos”/)).toBeTruthy();
  });

  test("preserva um título que já foi formulado como pergunta", () => {
    render(
      <ActiveRecall
        noteId="note-1"
        title="Por que a inflação pode elevar os juros?"
        content="Resposta."
      />
    );

    expect(screen.getByText("Por que a inflação pode elevar os juros?")).toBeTruthy();
    expect(screen.queryByText(/O que você consegue explicar/)).toBeNull();
  });
});
