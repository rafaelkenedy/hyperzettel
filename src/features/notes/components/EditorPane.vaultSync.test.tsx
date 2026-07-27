/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { findTemplate } from "@/domain/templates";
import { EditorPane } from "./EditorPane";

const mocks = vi.hoisted(() => ({
  reloadExternalChanges: vi.fn(),
  openReview: vi.fn(),
  activeRetention: null as { strength: number } | null,
  persistDraft: vi.fn(),
  saveNow: vi.fn(),
  setTitle: vi.fn(),
  setContent: vi.fn(),
  notes: {
    draft: {
      id: "draft-id",
      title: "Rascunho local",
      content: "<p>conteúdo</p>",
      folder: "inbox",
      kind: "fleeting",
      template: "blank",
      status: "draft",
      recallPrompt: "",
      connections: [],
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z"
    },
    currentNote: null,
    dirty: true,
    saving: false,
    loadToken: 0,
    externalVaultChange: true,
    syncingVault: false
  }
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({
    ...mocks.notes,
    reloadExternalChanges: mocks.reloadExternalChanges,
    persistDraft: mocks.persistDraft,
    saveNow: mocks.saveNow,
    setTitle: mocks.setTitle,
    setContent: mocks.setContent,
    deleteActiveNote: vi.fn()
  })
}));

vi.mock("@/app/providers/KnowledgeProvider", () => ({
  useKnowledge: () => ({ activeRetention: mocks.activeRetention })
}));

vi.mock("@/app/providers/NavigationProvider", () => ({
  useNavigation: () => ({ toggleMap: vi.fn(), openReview: mocks.openReview })
}));

vi.mock("@/app/providers/AnnouncerProvider", () => ({
  useAnnouncer: () => ({ announce: vi.fn() })
}));

vi.mock("@/app/useBackup", () => ({
  useBackup: () => ({ exportNotes: vi.fn(), importNotes: vi.fn() })
}));

vi.mock("@/features/onboarding/FirstCycleCoach", () => ({
  FirstCycleCoach: () => null
}));

vi.mock("@/features/onboarding/StructureConnections", () => ({
  StructureConnections: () => null
}));

afterEach(cleanup);

beforeEach(() => {
  mocks.reloadExternalChanges.mockReset();
  mocks.openReview.mockReset();
  mocks.persistDraft.mockReset().mockResolvedValue({ id: "draft-id" });
  mocks.notes.externalVaultChange = true;
  mocks.notes.draft.title = "Rascunho local";
  mocks.notes.draft.content = "<p>conteúdo</p>";
  mocks.notes.draft.kind = "fleeting";
  mocks.notes.draft.template = "blank";
  mocks.activeRetention = null;
});

test("oferece preservar a cópia local quando o vault muda durante a edição", () => {
  render(<EditorPane />);

  expect(screen.getByRole("status").textContent).toContain(
    "O vault mudou fora do aplicativo"
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preservar cópia e recarregar" })
  );
  expect(mocks.reloadExternalChanges).toHaveBeenCalledOnce();
});

test("orienta o título da nota de estudo como uma pergunta recuperável", () => {
  mocks.notes.externalVaultChange = false;
  mocks.notes.draft.title = "";
  mocks.notes.draft.template = "study";

  render(<EditorPane />);

  expect(
    screen.getByPlaceholderText("Que pergunta você quer conseguir responder?")
  ).toBeTruthy();
});

test("desabilita a conclusão enquanto a nota contém apenas o scaffolding", () => {
  mocks.notes.externalVaultChange = false;
  mocks.notes.draft.title = "Por que a inflação pode elevar os juros?";
  mocks.notes.draft.content = findTemplate("study").content;
  mocks.notes.draft.template = "study";

  render(<EditorPane />);

  expect(
    (
      screen.getByRole("button", {
        name: "Preencha o modelo antes de concluir"
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
});

test("persiste a nota antes de abrir uma revisão avulsa", async () => {
  mocks.notes.externalVaultChange = false;
  mocks.notes.draft.kind = "permanent";
  mocks.activeRetention = { strength: 0.92 };

  render(<EditorPane />);

  fireEvent.click(
    screen.getByRole("button", {
      name: "Abrir revisão ativa · retenção 92%"
    })
  );
  expect(mocks.persistDraft).toHaveBeenCalledOnce();
  await waitFor(() => expect(mocks.openReview).toHaveBeenCalledWith("draft-id"));
});

test("não abre a revisão quando a versão atual não pôde ser persistida", async () => {
  mocks.notes.externalVaultChange = false;
  mocks.notes.draft.kind = "permanent";
  mocks.activeRetention = { strength: 0.92 };
  mocks.persistDraft.mockResolvedValue(null);

  render(<EditorPane />);

  fireEvent.click(
    screen.getByRole("button", {
      name: "Abrir revisão ativa · retenção 92%"
    })
  );

  await waitFor(() => expect(mocks.persistDraft).toHaveBeenCalledOnce());
  expect(mocks.openReview).not.toHaveBeenCalled();
});
