/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { LAST_BACKUP_STORAGE_KEY } from "@/application/backupReminder";
import { useBackup } from "./useBackup";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  persistDraft: vi.fn(),
  reload: vi.fn(),
  adoptImported: vi.fn(),
  exportState: vi.fn(),
  mergeImported: vi.fn()
}));

vi.mock("@/application/backupService", () => ({
  createBackupService: () => ({
    exportBackup: mocks.exportBackup,
    importBackup: mocks.importBackup
  })
}));

vi.mock("@/app/providers/AnnouncerProvider", () => ({
  useAnnouncer: () => ({ announce: mocks.announce })
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({
    savedNotes: [{ id: "a" }],
    persistDraft: mocks.persistDraft,
    reload: mocks.reload,
    adoptImported: mocks.adoptImported
  })
}));

vi.mock("@/app/providers/KnowledgeProvider", () => ({
  useKnowledge: () => ({
    exportState: mocks.exportState,
    mergeImported: mocks.mergeImported
  })
}));

vi.mock("@/features/knowledge", () => ({
  exportRejectedRelations: vi.fn(),
  importRejectedRelations: vi.fn()
}));

function Probe() {
  const backup = useBackup();
  return (
    <>
      <p data-testid="status">{backup.backupStatus.state}</p>
      <button type="button" onClick={() => void backup.exportNotes()}>
        Exportar
      </button>
    </>
  );
}

afterEach(cleanup);

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  window.localStorage.clear();
  mocks.persistDraft.mockResolvedValue(undefined);
  mocks.exportBackup.mockResolvedValue({
    noteCount: 1,
    rejectedRelationCount: 0,
    blob: new Blob(["{}"], { type: "application/json" }),
    fileName: "backup.json"
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

describe("useBackup", () => {
  test("registra a exportação concluída e atualiza o lembrete", async () => {
    render(<Probe />);
    expect(screen.getByTestId("status").textContent).toBe("never");

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("current"));
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeTruthy();
    expect(mocks.announce).toHaveBeenCalledWith(
      "1 nota exportada; 0 decisões semânticas incluídas."
    );
  });

  test("não silencia o lembrete quando a exportação falha", async () => {
    mocks.exportBackup.mockRejectedValue(new Error("falhou"));
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith("Não foi possível exportar as notas.")
    );
    expect(screen.getByTestId("status").textContent).toBe("never");
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeNull();
  });
});
