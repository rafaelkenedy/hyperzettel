/**
 * @vitest-environment jsdom
 */

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { GraphNote, KnowledgeSnapshot } from "../model/knowledgeModel";
import { ReviewQueue } from "./ReviewQueue";

const mocks = vi.hoisted(() => ({
  openNote: vi.fn(),
  consumeRequest: vi.fn(),
  snapshot: null as KnowledgeSnapshot | null,
  savedNotes: [] as Array<{
    id: string;
    title: string;
    content: string;
    recallPrompt: string;
  }>
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({
    openNote: mocks.openNote,
    savedNotes: mocks.savedNotes
  })
}));

vi.mock("@/app/providers/KnowledgeProvider", () => ({
  useKnowledge: () => ({ snapshot: mocks.snapshot })
}));

vi.mock("./ActiveRecall", () => ({
  ActiveRecall: ({
    title,
    onReviewed
  }: {
    title: string;
    onReviewed?: () => void;
  }) => <button onClick={onReviewed}>Avaliar {title}</button>
}));

const AT = "2026-05-03T12:00:00.000Z";

function graphNote(
  id: string,
  title: string,
  dueAt: string | null,
  strength = 0.4
): GraphNote {
  return {
    id,
    title,
    folder: "resources",
    kind: "permanent",
    status: "saved",
    connections: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    baselineAt: "2026-01-01T00:00:00.000Z",
    lastReviewedAt: null,
    dueAt,
    easeFactor: 2.5,
    repetitions: 0,
    intervalDays: 1,
    reviewCount: 0,
    history: [],
    strength,
    level: "weak"
  };
}

function snapshot(notes: GraphNote[]): KnowledgeSnapshot {
  return {
    at: AT,
    notes,
    edges: [],
    metrics: {
      average: 0,
      strongEdges: 0,
      mediumEdges: 0,
      weakEdges: 0,
      reviewDue: notes.length
    }
  };
}

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return <ReviewQueue selectedId={selectedId} onFocus={setSelectedId} />;
}

function RequestedHarness({ noteId }: { noteId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <ReviewQueue
      selectedId={selectedId}
      onFocus={setSelectedId}
      requestedId={noteId}
      onRequestConsumed={mocks.consumeRequest}
    />
  );
}

beforeEach(() => {
  mocks.openNote.mockReset().mockResolvedValue(undefined);
  mocks.consumeRequest.mockReset();
  mocks.savedNotes = [];
});

afterEach(cleanup);

describe("ReviewQueue", () => {
  test("abre a primeira vencida, avança e encerra uma sessão finita", async () => {
    const first = graphNote("a", "Primeira", "2026-05-01T12:00:00.000Z");
    const second = graphNote("b", "Segunda", "2026-05-02T12:00:00.000Z");
    mocks.snapshot = snapshot([second, first]);
    mocks.savedNotes = [
      { id: "a", title: "Primeira", content: "A", recallPrompt: "" },
      { id: "b", title: "Segunda", content: "B", recallPrompt: "" }
    ];

    render(<Harness />);

    await screen.findByRole("button", { name: "Avaliar Primeira" });
    expect(screen.getByText("0 de 2 concluídas")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avaliar Primeira" }));

    await screen.findByRole("button", { name: "Avaliar Segunda" });
    expect(screen.queryByText("Primeira")).toBeNull();
    expect(screen.getByText("1 de 2 concluídas")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Avaliar Segunda" }));

    await waitFor(() =>
      expect(screen.getByText("Sessão concluída")).toBeTruthy()
    );
    expect(screen.getByText("2 notas revisadas.")).toBeTruthy();
  });

  test("não inclui uma nota cuja revisão ainda não venceu", () => {
    mocks.snapshot = snapshot([
      graphNote("futura", "Ainda fresca", "2026-05-04T12:00:00.000Z", 0.9)
    ]);

    render(<Harness />);

    expect(screen.getByText("Tudo em dia")).toBeTruthy();
    expect(screen.getByText("Nenhuma revisão está vencida agora.")).toBeTruthy();
    expect(screen.queryByText("Ainda fresca")).toBeNull();
  });

  test("abre somente a nota escolhida quando a revisão parte do editor", async () => {
    const fresh = graphNote(
      "futura",
      "Ainda fresca",
      "2026-05-04T12:00:00.000Z",
      0.9
    );
    const overdue = graphNote("vencida", "Outra vencida", "2026-05-01T12:00:00.000Z");
    mocks.snapshot = snapshot([fresh, overdue]);
    mocks.savedNotes = [
      { id: "futura", title: "Ainda fresca", content: "Resposta", recallPrompt: "" },
      { id: "vencida", title: "Outra vencida", content: "Outra", recallPrompt: "" }
    ];

    render(<RequestedHarness noteId="futura" />);

    await screen.findByRole("button", { name: "Avaliar Ainda fresca" });
    expect(screen.queryByText("Outra vencida")).toBeNull();
    expect(screen.getByText(/Revisão escolhida/)).toBeTruthy();
    expect(mocks.consumeRequest).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Avaliar Ainda fresca" }));
    await screen.findByText("Sessão concluída");
    expect(screen.getByText("1 nota revisada.")).toBeTruthy();
  });
});
