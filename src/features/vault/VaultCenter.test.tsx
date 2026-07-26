/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import { VaultCenter } from "./VaultCenter";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  reload: vi.fn(),
  enqueue: vi.fn(),
  getInfo: vi.fn(),
  inspectVault: vi.fn(),
  adoptDocument: vi.fn(),
  reindexFromVault: vi.fn(),
  openFolder: vi.fn()
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
    reindexFromVault: mocks.reindexFromVault,
    openFolder: mocks.openFolder
  }
}));

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

describe("VaultCenter", () => {
  test("mostra caminho, diagnóstico e abre a pasta", async () => {
    render(<VaultCenter open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("C:\\dados\\Hyperzettel\\vault")).toBeTruthy();
    expect(screen.getByText("manual.html")).toBeTruthy();
    expect(screen.getByText("2 arquivos HTML · 2.0 KB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abrir pasta" }));
    await waitFor(() => expect(mocks.openFolder).toHaveBeenCalledOnce());
  });

  test("adota arquivo externo, atualiza a coleção e verifica novamente", async () => {
    const adopted = createNoteRecord({
      id: "adopted-id",
      title: "Manual",
      status: "saved"
    });
    mocks.adoptDocument.mockResolvedValue(adopted);

    render(<VaultCenter open onOpenChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Adotar" }));

    await waitFor(() =>
      expect(mocks.adoptDocument).toHaveBeenCalledWith("manual.html")
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(adopted);
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.inspectVault).toHaveBeenCalledTimes(2);
  });
});
