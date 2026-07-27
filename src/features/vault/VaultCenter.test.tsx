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
  resolveDuplicateId: vi.fn(),
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
    resolveDuplicateId: mocks.resolveDuplicateId,
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

    render(<VaultCenter open onOpenChange={vi.fn()} />);

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
