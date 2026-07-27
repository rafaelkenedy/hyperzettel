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
  mergeImported: vi.fn(),
  saveVerifiedBackup: vi.fn(),
  dirty: vi.fn()
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
    dirty: mocks.dirty(),
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

vi.mock("@/infrastructure/backupFileRepository", () => ({
  saveVerifiedBackup: mocks.saveVerifiedBackup,
  backupFileErrorMessage: () => "Não foi possível exportar as notas."
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
  mocks.dirty.mockReturnValue(false);
  mocks.exportBackup.mockResolvedValue({
    noteCount: 1,
    rejectedRelationCount: 0,
    contents: "{}",
    fileName: "backup.json"
  });
  mocks.saveVerifiedBackup.mockResolvedValue({
    path: "C:\\backups\\backup.json",
    fileName: "backup.json",
    bytes: 2,
    sha256: "a".repeat(64)
  });
});

describe("useBackup", () => {
  test("registra a exportação concluída e atualiza o lembrete", async () => {
    render(<Probe />);
    expect(screen.getByTestId("status").textContent).toBe("never");

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("current"));
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeTruthy();
    expect(mocks.saveVerifiedBackup).toHaveBeenCalledWith("backup.json", "{}");
    expect(mocks.announce).toHaveBeenCalledWith(
      "Backup verificado em “backup.json”: 1 nota exportada; 0 decisões semânticas incluídas."
    );
  });

  test("cancelar o seletor não registra um backup inexistente", async () => {
    mocks.saveVerifiedBackup.mockResolvedValue(null);
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith(
        "Exportação cancelada; o lembrete de backup continua ativo."
      )
    );
    expect(screen.getByTestId("status").textContent).toBe("never");
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeNull();
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

  test("não registra o backup quando a gravação nativa falha", async () => {
    mocks.saveVerifiedBackup.mockRejectedValue({
      code: "backup_io_error",
      message: "disco cheio"
    });
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith("Não foi possível exportar as notas.")
    );
    expect(screen.getByTestId("status").textContent).toBe("never");
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeNull();
  });

  test("não abre o destino quando um rascunho pendente não pôde ser salvo", async () => {
    mocks.dirty.mockReturnValue(true);
    mocks.persistDraft.mockResolvedValue(null);
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith(
        "O rascunho atual não pôde ser salvo. Resolva o conflito antes de criar um backup."
      )
    );
    expect(mocks.exportBackup).not.toHaveBeenCalled();
    expect(mocks.saveVerifiedBackup).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LAST_BACKUP_STORAGE_KEY)).toBeNull();
  });
});
