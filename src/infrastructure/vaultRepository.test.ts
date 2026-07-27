/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import {
  inspectVaultDocuments,
  toIndexRow
} from "@/infrastructure/vaultRepository";
import { serializeNoteToHtmlDocument } from "@/shared/noteDocument";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

beforeEach(() => {
  invokeMock.mockReset();
});

describe("toIndexRow", () => {
  test("usa timestamp, título e id curto para o nome de uma nota nova", () => {
    const note = createNoteRecord({
      id: "a1b2c3d4-e5f6-4789-abcd-0123456789ab",
      title: "Nova ideia",
      createdAt: "2026-07-26T19:45:30.000Z"
    });

    expect(toIndexRow(note).fileName).toBe(
      "20260726-194530--nova-ideia--a1b2c3d4.html"
    );
  });

  test("preserva o nome físico de um arquivo descoberto no vault", () => {
    const note = createNoteRecord({ id: "internal-id", title: "Manual" });

    expect(toIndexRow(note, "minha-nota-manual.html").fileName).toBe(
      "minha-nota-manual.html"
    );
  });

  test("inclui a pergunta de recuperação na linha derivada", () => {
    const note = createNoteRecord({
      id: "note-prompt",
      title: "Teste ativo",
      recallPrompt: "Por que testar antes de reler?"
    });

    expect(toIndexRow(note).recallPrompt).toBe("Por que testar antes de reler?");
  });

  test("reindexa um arquivo manual sem exigir que o nome corresponda ao id", async () => {
    const note = createNoteRecord({ id: "internal-id", title: "Manual" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "read_all_note_files") {
        return Promise.resolve([
          {
            fileName: "minha-nota-manual.html",
            html: serializeNoteToHtmlDocument(note),
            contentHash: "hash-manual"
          }
        ]);
      }
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reindexFromVault()).resolves.toEqual({
      indexed: 1,
      issues: []
    });
    expect(invokeMock).toHaveBeenCalledWith("rebuild_note_index", {
      rows: [
        expect.objectContaining({
          id: "internal-id",
          fileName: "minha-nota-manual.html"
        })
      ]
    });
  });

  test("abre e remove pelo id interno, sem recalcular o nome físico", async () => {
    const note = createNoteRecord({ id: "internal-id", title: "Manual" });
    const html = serializeNoteToHtmlDocument(note);
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "read_note") return Promise.resolve(html);
      if (command === "delete_note") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.read("internal-id")).resolves.toMatchObject({
      id: "internal-id",
      title: "Manual"
    });
    await expect(vaultRepository.remove("internal-id")).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("read_note", { id: "internal-id" });
    expect(invokeMock).toHaveBeenCalledWith("delete_note", { id: "internal-id" });
  });

  test("repara um índice antigo cujo nome físico foi substituído pelo id", async () => {
    const note = createNoteRecord({ id: "internal-id", title: "Manual" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") {
        return Promise.resolve([
          toIndexRow(note, "internal-id.html")
        ]);
      }
      if (command === "list_note_files") {
        return Promise.resolve([
          { fileName: "minha-nota-manual.html", contentHash: "hash-manual" }
        ]);
      }
      if (command === "read_all_note_files") {
        return Promise.resolve([
          {
            fileName: "minha-nota-manual.html",
            html: serializeNoteToHtmlDocument(note),
            contentHash: "hash-manual"
          }
        ]);
      }
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reconcileIndexWithVault()).resolves.toEqual({
      indexed: 1,
      issues: []
    });
    expect(invokeMock).toHaveBeenCalledWith("rebuild_note_index", {
      rows: [
        expect.objectContaining({
          id: "internal-id",
          fileName: "minha-nota-manual.html"
        })
      ]
    });
  });

  test("não lê os documentos quando os nomes do índice e do vault conferem", async () => {
    const note = createNoteRecord({ id: "internal-id", title: "Normal" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const indexed = toIndexRow(note, undefined, "same-hash");
    const fileName = indexed.fileName;

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") return Promise.resolve([indexed]);
      if (command === "list_note_files") {
        return Promise.resolve([{ fileName, contentHash: "same-hash" }]);
      }
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reconcileIndexWithVault()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("read_all_note_files", expect.anything());
  });

  test("reindexa quando o conteúdo muda sem alterar o nome físico", async () => {
    const before = createNoteRecord({ id: "internal-id", title: "Antes" });
    const after = createNoteRecord({ ...before, title: "Depois" });
    const fileName = "nota-manual.html";
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") {
        return Promise.resolve([toIndexRow(before, fileName, "old-hash")]);
      }
      if (command === "list_note_files") {
        return Promise.resolve([{ fileName, contentHash: "new-hash" }]);
      }
      if (command === "read_all_note_files") {
        return Promise.resolve([
          {
            fileName,
            html: serializeNoteToHtmlDocument(after),
            contentHash: "new-hash"
          }
        ]);
      }
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reconcileIndexWithVault()).resolves.toEqual({
      indexed: 1,
      issues: []
    });
    expect(invokeMock).toHaveBeenCalledWith("rebuild_note_index", {
      rows: [
        expect.objectContaining({
          id: "internal-id",
          title: "Depois",
          contentHash: "new-hash"
        })
      ]
    });
  });

  test("não deixa ids duplicados colapsarem silenciosamente no índice", async () => {
    const note = createNoteRecord({ id: "duplicated-id", title: "Duplicada" });
    const html = serializeNoteToHtmlDocument(note);
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "read_all_note_files") {
        return Promise.resolve([
          { fileName: "uma.html", html, contentHash: "hash-1" },
          { fileName: "duas.html", html, contentHash: "hash-2" }
        ]);
      }
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reindexFromVault()).resolves.toEqual({
      indexed: 0,
      issues: [
        {
          code: "duplicate_id",
          id: "duplicated-id",
          fileNames: ["uma.html", "duas.html"]
        }
      ]
    });
    expect(invokeMock).toHaveBeenCalledWith("rebuild_note_index", { rows: [] });
  });

  test("reporta arquivo sem hz:id em vez de descartá-lo silenciosamente", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "read_all_note_files") {
        return Promise.resolve([
          {
            fileName: "sem-id.html",
            html: "<!doctype html><html><body>sem id</body></html>",
            contentHash: "hash-invalid"
          }
        ]);
      }
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.reindexFromVault()).resolves.toEqual({
      indexed: 0,
      issues: [{ code: "missing_id", fileNames: ["sem-id.html"] }]
    });
  });

  test("inspeção é pura e não reconstrói o índice", () => {
    const valid = createNoteRecord({ id: "valid-id", title: "Válida" });
    const inspection = inspectVaultDocuments([
      {
        fileName: "valida.html",
        html: serializeNoteToHtmlDocument(valid),
        contentHash: "hash-valid"
      },
      {
        fileName: "externa.html",
        html: "<html><head><title>Externa</title></head><body><p>conteúdo</p></body></html>",
        contentHash: "hash-external"
      }
    ]);

    expect(inspection).toMatchObject({
      indexed: 1,
      issues: [{ code: "missing_id", fileNames: ["externa.html"] }]
    });
    expect(inspection.rows[0]).toMatchObject({
      id: "valid-id",
      fileName: "valida.html",
      contentHash: "hash-valid"
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("adota HTML externo preservando o nome e protegendo a versão pelo hash", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const externalHtml =
      "<html><head><title>Nota externa</title></head><body><p>Uma ideia.</p></body></html>";

    invokeMock.mockImplementation((command: string) => {
      if (command === "read_all_note_files") {
        return Promise.resolve([
          {
            fileName: "minha-nota.html",
            html: externalHtml,
            contentHash: "hash-before"
          }
        ]);
      }
      if (command === "adopt_note_file") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    const adopted = await vaultRepository.adoptDocument("minha-nota.html");

    expect(adopted).toMatchObject({
      title: "Nota externa",
      folder: "inbox",
      kind: "fleeting",
      status: "saved"
    });
    expect(invokeMock).toHaveBeenCalledWith("adopt_note_file", {
      row: expect.objectContaining({
        id: adopted.id,
        fileName: "minha-nota.html",
        title: "Nota externa"
      }),
      expectedHash: "hash-before",
      html: expect.stringContaining(`<meta name="hz:id" content="${adopted.id}">`)
    });
  });
});
