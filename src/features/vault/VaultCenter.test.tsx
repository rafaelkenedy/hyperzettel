/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { BackupStatus } from "@/application/backupReminder";
import { createNoteRecord } from "@/domain/notes";
import { VaultCenter } from "./VaultCenter";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  reload: vi.fn(),
  enqueue: vi.fn(),
  getInfo: vi.fn(),
  inspectVault: vi.fn(),
  adoptDocument: vi.fn(),
  resolveDuplicateId: vi.fn(),
  reindexFromVault: vi.fn(),
  openFolder: vi.fn(),
  exportBackup: vi.fn()
}));

vi.mock("@/app/providers/AnnouncerProvider", () => ({
  useAnnouncer: () => ({ announce: mocks.announce })
}));

vi.mock("@/app/providers/NotesProvider", () => ({
  useNotes: () => ({ reload: mocks.reload })
}));

vi.mock("@/features/knowledge", () => ({
  enqueueNoteIndexing: mocks.enqueue
}));

vi.mock("@/infrastructure/vaultRepository", () => ({
  vaultErrorMessage: (_error: unknown, fallback: string) => fallback,
  vaultRepository: {
    getInfo: mocks.getInfo,
    inspectVault: mocks.inspectVault,
    adoptDocument: mocks.adoptDocument,
    resolveDuplicateId: mocks.resolveDuplicateId,
    reindexFromVault: mocks.reindexFromVault,
    openFolder: mocks.openFolder
  }
}));

afterEach(cleanup);

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getInfo.mockResolvedValue({
    rootPath: "C:\\dados\\Hyperzettel\\vault",
    fileCount: 2,
    totalBytes: 2048
  });
  mocks.inspectVault.mockResolvedValue({
    indexed: 1,
    rows: [],
    issues: [{ code: "missing_id", fileNames: ["manual.html"] }]
  });
  mocks.reload.mockResolvedValue([]);
  mocks.openFolder.mockResolvedValue(undefined);
});

function renderVaultCenter(
  backupStatus: BackupStatus = {
    state: "never",
    lastExportedAt: null,
    ageDays: null
  }
) {
  return render(
    <VaultCenter
      open
      onOpenChange={vi.fn()}
      backupStatus={backupStatus}
      backupExporting={false}
      onExportBackup={mocks.exportBackup}
    />
  );
}

describe("VaultCenter", () => {
  test("mostra caminho, diagnóstico e abre a pasta", async () => {
    renderVaultCenter();

    expect(await screen.findByText("C:\\dados\\Hyperzettel\\vault")).toBeTruthy();
    expect(screen.getByText("manual.html")).toBeTruthy();
    expect(screen.getByText("2 arquivos HTML · 2.0 KB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir pasta" }));
    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledOnce());
  });

  test("torna o primeiro backup visível e oferece a ação assistida", async () => {
    renderVaultCenter();

    expect(screen.getByText("Primeiro backup recomendado")).toBeTruthy();
    expect(
      screen.getByText(/preserva revisões e decisões semânticas/)
    ).toBeTruthy();
    expect(screen.getByText(/relê o arquivo antes de registrar/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Exportar backup" }));
    expect(mocks.exportBackup).toHaveBeenCalledOnce();
  });

  test("mostra quando o backup semanal está em dia", () => {
    renderVaultCenter({
      state: "current",
      lastExportedAt: "2026-07-26T12:00:00.000Z",
      ageDays: 1
    });

    expect(screen.getByText("Backup em dia")).toBeTruthy();
    expect(screen.getByText(/feita ontem/)).toBeTruthy();
  });

  test("expõe arquivo grande como conflito recuperável sem ação destrutiva", async () => {
    mocks.inspectVault.mockResolvedValue({
      indexed: 1,
      rows: [],
      issues: [
        {
          code: "document_too_large",
          fileNames: ["atlas-visual.html"],
          sizeBytes: 31_457_280,
          maxBytes: 26_214_400
        }
      ]
    });

    renderVaultCenter();

    expect(await screen.findByText("Arquivos muito grandes")).toBeTruthy();
    expect(screen.getByText("atlas-visual.html")).toBeTruthy();
    expect(screen.getByText("30.0 MB · máximo 25.0 MB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adotar" })).toBeNull();
  });

  test("adota arquivo externo, atualiza a coleção e verifica novamente", async () => {
    const adopted = createNoteRecord({
      id: "adopted-id",
      title: "Manual",
      status: "saved"
    });
    mocks.adoptDocument.mockResolvedValue(adopted);

    renderVaultCenter();

    fireEvent.click(await screen.findByRole("button", { name: "Adotar" }));

    await waitFor(() =>
      expect(mocks.adoptDocument).toHaveBeenCalledWith("manual.html")
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(adopted);
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.inspectVault).toHaveBeenCalledTimes(2);
  });

  test("separa cópias preservando o arquivo escolhido e recarrega a coleção", async () => {
    const separated = createNoteRecord({
      id: "new-copy-id",
      title: "Cópia separada",
      status: "saved"
    });
    mocks.inspectVault.mockResolvedValue({
      indexed: 0,
      rows: [],
      issues: [
        {
          code: "duplicate_id",
          id: "duplicated-id",
          fileNames: ["principal.html", "copia.html"]
        }
      ]
    });
    mocks.resolveDuplicateId.mockResolvedValue({
      keeperFileName: "principal.html",
      separated: [separated]
    });

    renderVaultCenter();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Manter o ID em principal.html"
      })
    );

    await waitFor(() =>
      expect(mocks.resolveDuplicateId).toHaveBeenCalledWith(
        "duplicated-id",
        "principal.html"
      )
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(separated);
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.inspectVault).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText(
        "“principal.html” manteve a identidade original; 1 cópia recebeu nova identidade."
      )
    ).toBeTruthy();
  });
});
