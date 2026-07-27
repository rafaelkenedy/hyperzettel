/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { EditorPane } from "./EditorPane";

const mocks = vi.hoisted(() => ({
  reloadExternalChanges: vi.fn(),
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
    saveNow: mocks.saveNow,
    setTitle: mocks.setTitle,
    setContent: mocks.setContent,
    deleteActiveNote: vi.fn()
  })
}));

vi.mock("@/app/providers/KnowledgeProvider", () => ({
  useKnowledge: () => ({ activeRetention: null })
}));

vi.mock("@/app/providers/NavigationProvider", () => ({
  useNavigation: () => ({ toggleMap: vi.fn() })
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
