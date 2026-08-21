/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

import { createNoteRecord } from "@/domain/notes";
import {
  inspectVaultDocuments,
  MAX_NOTE_DOCUMENT_BYTES,
  relatedNoteViews,
  toIndexRow
} from "@/infrastructure/vaultRepository";
import {
  parseHtmlDocumentToNote,
  serializeNoteToHtmlDocument
} from "@/shared/noteDocument";

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

  test("recusa uma nota acima de 25 MiB antes de atravessar o IPC", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const size = vi
      .spyOn(Blob.prototype, "size", "get")
      .mockReturnValue(MAX_NOTE_DOCUMENT_BYTES + 1);
    const note = createNoteRecord({
      id: "large-id",
      title: "Grande",
      content: "<p>conteúdo</p>"
    });

    await expect(vaultRepository.save(note)).rejects.toMatchObject({
      code: "note_document_too_large",
      maxBytes: MAX_NOTE_DOCUMENT_BYTES
    });
    expect(invokeMock).not.toHaveBeenCalled();
    size.mockRestore();
  });

  test("repara o índice e repete o save quando o HTML já foi gravado", async () => {
    const note = createNoteRecord({
      id: "recovered-id",
      title: "Salva apesar do índice",
      content: "<p>fonte da verdade</p>",
      status: "saved"
    });
    let documents: Array<{
      fileName: string;
      html: string;
      contentHash: string;
    }> = [];
    let saveAttempts = 0;
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation(
      (
        command: string,
        args?: {
          row?: { fileName: string };
          html?: string;
          rows?: unknown[];
        }
      ) => {
        if (command === "save_note") {
          saveAttempts += 1;
          if (saveAttempts === 1) {
            documents = [
              {
                fileName: args!.row!.fileName,
                html: args!.html!,
                contentHash: "hash-written"
              }
            ];
            return Promise.reject({
              code: "index_error",
              message: "falha depois da escrita"
            });
          }
          return Promise.resolve();
        }
        if (command === "read_all_note_files") return Promise.resolve(documents);
        if (command === "rebuild_note_index") {
          expect(args?.rows).toEqual([
            expect.objectContaining({
              id: "recovered-id",
              contentHash: "hash-written"
            })
          ]);
          return Promise.resolve();
        }
        return Promise.reject(new Error(`comando inesperado: ${command}`));
      }
    );

    await expect(vaultRepository.save(note)).resolves.toBeUndefined();
    expect(saveAttempts).toBe(2);
  });

  test("não repete o save quando a falha do índice ocorreu antes da escrita", async () => {
    const before = createNoteRecord({
      id: "protected-id",
      title: "Versão externa",
      content: "<p>não sobrescrever</p>",
      status: "saved"
    });
    const attempted = createNoteRecord({
      ...before,
      title: "Versão do editor",
      content: "<p>rascunho local</p>"
    });
    const document = {
      fileName: "protegida.html",
      html: serializeNoteToHtmlDocument(before),
      contentHash: "hash-external"
    };
    let saveAttempts = 0;
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "save_note") {
        saveAttempts += 1;
        return Promise.reject({
          code: "index_error",
          message: "falha antes da escrita"
        });
      }
      if (command === "read_all_note_files") return Promise.resolve([document]);
      if (command === "rebuild_note_index") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.save(attempted)).rejects.toMatchObject({
      code: "index_error"
    });
    expect(saveAttempts).toBe(1);
  });

  test("considera concluída a exclusão quando só a limpeza do índice falhou", async () => {
    let deleteAttempts = 0;
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "delete_note") {
        deleteAttempts += 1;
        return Promise.reject({
          code: "index_error",
          message: "arquivo removido; índice falhou"
        });
      }
      if (command === "read_all_note_files") return Promise.resolve([]);
      if (command === "rebuild_note_index") return Promise.resolve();
      if (command === "list_notes") return Promise.resolve([]);
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.remove("removed-id")).resolves.toBeUndefined();
    expect(deleteAttempts).toBe(1);
  });

  test("não repete a exclusão quando o reparo confirma que o arquivo ainda existe", async () => {
    const note = createNoteRecord({ id: "still-there", title: "Ainda existe" });
    const document = {
      fileName: "ainda-existe.html",
      html: serializeNoteToHtmlDocument(note),
      contentHash: "hash-still-there"
    };
    const indexed = toIndexRow(note, document.fileName, document.contentHash);
    let deleteAttempts = 0;
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "delete_note") {
        deleteAttempts += 1;
        return Promise.reject({
          code: "index_error",
          message: "falha antes de excluir"
        });
      }
      if (command === "read_all_note_files") return Promise.resolve([document]);
      if (command === "rebuild_note_index") return Promise.resolve();
      if (command === "list_notes") return Promise.resolve([indexed]);
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.remove("still-there")).rejects.toMatchObject({
      code: "index_error"
    });
    expect(deleteAttempts).toBe(1);
  });

  test("trata note_not_found como ausência normal, sem reindexar o vault", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    invokeMock.mockRejectedValue({
      code: "note_not_found",
      message: "nota não indexada"
    });

    await expect(vaultRepository.read("rascunho-local")).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("read_note", {
      id: "rascunho-local"
    });
  });

  test("continua propagando uma falha real de leitura", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    invokeMock.mockRejectedValue({
      code: "io_error",
      message: "disco indisponível"
    });

    await expect(vaultRepository.read("nota")).rejects.toMatchObject({
      code: "io_error"
    });
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

  test("detecta mudança externa por fingerprint sem reconstruir o índice", async () => {
    const note = createNoteRecord({ id: "internal-id", title: "Normal" });
    const indexed = toIndexRow(note, "normal.html", "old-hash");
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") return Promise.resolve([indexed]);
      if (command === "list_note_files") {
        return Promise.resolve([{ fileName: "normal.html", contentHash: "new-hash" }]);
      }
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.hasExternalChanges()).resolves.toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("read_all_note_files", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("rebuild_note_index", expect.anything());
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

  test("separa cópias por CAS e preserva o id no arquivo escolhido", async () => {
    const principal = createNoteRecord({
      id: "duplicated-id",
      title: "Principal",
      status: "saved"
    });
    const copy = createNoteRecord({
      ...principal,
      title: "Cópia divergente"
    });
    let documents = [
      {
        fileName: "principal.html",
        html: serializeNoteToHtmlDocument(principal),
        contentHash: "hash-principal"
      },
      {
        fileName: "copia.html",
        html: serializeNoteToHtmlDocument(copy),
        contentHash: "hash-copy"
      }
    ];
    const rebuilds: unknown[] = [];
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation(
      (
        command: string,
        args?: {
          row?: { id: string; fileName: string };
          expectedHash?: string;
          html?: string;
          rows?: unknown[];
        }
      ) => {
        if (command === "read_all_note_files") {
          return Promise.resolve(documents);
        }
        if (command === "rebuild_note_index") {
          rebuilds.push(args?.rows ?? []);
          return Promise.resolve();
        }
        if (command === "adopt_note_file") {
          expect(args?.row?.fileName).toBe("copia.html");
          expect(args?.expectedHash).toBe("hash-copy");
          documents = documents.map((document) =>
            document.fileName === "copia.html"
              ? {
                  ...document,
                  html: args?.html ?? "",
                  contentHash: "hash-copy-rewritten"
                }
              : document
          );
          return Promise.resolve();
        }
        return Promise.reject(new Error(`comando inesperado: ${command}`));
      }
    );

    const result = await vaultRepository.resolveDuplicateId(
      "duplicated-id",
      "principal.html"
    );

    expect(result.keeperFileName).toBe("principal.html");
    expect(result.separated).toHaveLength(1);
    expect(result.separated[0]).toMatchObject({
      title: "Cópia divergente",
      status: "saved"
    });
    expect(result.separated[0]!.id).not.toBe("duplicated-id");
    expect(
      parseHtmlDocumentToNote(
        documents.find((document) => document.fileName === "principal.html")!.html
      )!.id
    ).toBe("duplicated-id");
    expect(
      parseHtmlDocumentToNote(
        documents.find((document) => document.fileName === "copia.html")!.html
      )!.id
    ).toBe(result.separated[0]!.id);
    expect(rebuilds).toHaveLength(2);
    expect(rebuilds[0]).toEqual([]);
    expect(rebuilds[1]).toEqual([
      expect.objectContaining({ id: "duplicated-id", fileName: "principal.html" }),
      expect.objectContaining({ id: result.separated[0]!.id, fileName: "copia.html" })
    ]);
  });

  test("interrompe a separação quando o grupo mudou após a verificação", async () => {
    const unique = createNoteRecord({ id: "unique-id", title: "Única" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockResolvedValue([
      {
        fileName: "unica.html",
        html: serializeNoteToHtmlDocument(unique),
        contentHash: "hash-unique"
      }
    ]);

    await expect(
      vaultRepository.resolveDuplicateId("duplicated-id", "unica.html")
    ).rejects.toMatchObject({ code: "duplicate_resolution_stale" });
    expect(invokeMock).toHaveBeenCalledTimes(1);
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

  test("isola documento grande sem tentar parsear conteúdo ausente", () => {
    expect(
      inspectVaultDocuments([
        {
          fileName: "arquivo-grande.html",
          html: null,
          contentHash: "oversized:26214401",
          sizeBytes: 26_214_401,
          maxBytes: 26_214_400
        }
      ])
    ).toEqual({
      indexed: 0,
      rows: [],
      issues: [
        {
          code: "document_too_large",
          fileNames: ["arquivo-grande.html"],
          sizeBytes: 26_214_401,
          maxBytes: 26_214_400
        }
      ]
    });
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

describe("relatedNoteViews", () => {
  const alpha = createNoteRecord({
    id: "alpha",
    title: "Alpha",
    connections: [{ id: "beta", reason: "porque X" }]
  });
  const beta = createNoteRecord({ id: "beta", title: "Beta" });
  const gama = createNoteRecord({
    id: "gama",
    title: "Gama",
    connections: [{ id: "beta", reason: "porque Y" }]
  });

  const rows = [
    toIndexRow(alpha, "alpha.html"),
    toIndexRow(beta, "beta.html"),
    toIndexRow(gama, "gama.html")
  ];

  test("descobre o backlink que só existe na conexão da outra nota", () => {
    const views = relatedNoteViews(beta, rows);

    expect(views).toEqual([
      {
        id: "alpha",
        title: "Alpha",
        fileName: "alpha.html",
        direction: "incoming",
        reason: "",
        incomingReason: "porque X"
      },
      {
        id: "gama",
        title: "Gama",
        fileName: "gama.html",
        direction: "incoming",
        reason: "",
        incomingReason: "porque Y"
      }
    ]);
  });

  test("marca como mútua a relação declarada dos dois lados", () => {
    const mutuo = createNoteRecord({
      ...beta,
      connections: [{ id: "alpha", reason: "de volta" }]
    });

    expect(relatedNoteViews(mutuo, rows)).toContainEqual(
      expect.objectContaining({
        id: "alpha",
        direction: "mutual",
        reason: "de volta",
        incomingReason: "porque X"
      })
    );
  });

  test("usa o nome físico do índice, não o derivado do título", () => {
    const renomeada = [toIndexRow(alpha, "nome-escolhido-a-mao.html"), rows[1]];

    expect(relatedNoteViews(beta, renomeada)[0].fileName).toBe(
      "nome-escolhido-a-mao.html"
    );
  });

  test("deixa o arquivo vazio quando o alvo não está no índice", () => {
    const orfa = createNoteRecord({
      id: "orfa",
      title: "Órfã",
      connections: [{ id: "sumiu", reason: "" }]
    });

    expect(relatedNoteViews(orfa, [])).toEqual([]);
  });
});

describe("save com backlinks", () => {
  test("grava no arquivo quem cita a nota, com âncora para o arquivo", async () => {
    const alpha = createNoteRecord({
      id: "alpha",
      title: "Alpha",
      connections: [{ id: "beta", reason: "porque X" }]
    });
    const beta = createNoteRecord({ id: "beta", title: "Beta" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") {
        return Promise.resolve([
          toIndexRow(alpha, "alpha.html"),
          toIndexRow(beta, "beta.html")
        ]);
      }
      if (command === "save_note") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await vaultRepository.save(beta);

    const [, payload] = invokeMock.mock.calls.find(([command]) => command === "save_note")!;
    expect(payload.html).toContain("<h3>Citada por</h3>");
    expect(payload.html).toContain('<a href="alpha.html" title="alpha">Alpha</a>');
    expect(payload.html).toContain('<p class="hz-connection-reason">porque X</p>');
    // O backlink é apresentação: o head continua registrando só a saída.
    expect(payload.html).not.toContain('name="hz:connection"');
  });

  test("salva mesmo quando o índice não responde, sem o backlink", async () => {
    const beta = createNoteRecord({ id: "beta", title: "Beta" });
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");

    invokeMock.mockImplementation((command: string) => {
      if (command === "list_notes") return Promise.reject(new Error("índice fora"));
      if (command === "save_note") return Promise.resolve();
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.save(beta)).resolves.toBeUndefined();
  });
});

describe("refreshConnectionProjections", () => {
  const alpha = createNoteRecord({
    id: "alpha",
    title: "Alpha",
    connections: [{ id: "beta", reason: "porque X" }]
  });
  const beta = createNoteRecord({ id: "beta", title: "Beta" });

  test("reescreve só o arquivo cuja projeção está desatualizada", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const rows = [toIndexRow(alpha, "alpha.html"), toIndexRow(beta, "beta.html")];
    // Alpha já foi salva com o contexto; Beta ainda não conhece o backlink.
    const stored = new Map([
      ["alpha", serializeNoteToHtmlDocument(alpha, relatedNoteViews(alpha, rows))],
      ["beta", serializeNoteToHtmlDocument(beta)]
    ]);
    const written: string[] = [];

    invokeMock.mockImplementation((command: string, payload?: any) => {
      if (command === "list_notes") return Promise.resolve(rows);
      if (command === "read_note") return Promise.resolve(stored.get(payload.id));
      if (command === "save_note") {
        written.push(payload.row.id);
        return Promise.resolve();
      }
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.refreshConnectionProjections()).resolves.toEqual({
      updated: 1,
      current: 1,
      skipped: 0
    });
    expect(written).toEqual(["beta"]);
  });

  test("preserva o nome físico do arquivo ao reescrever", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const rows = [
      toIndexRow(alpha, "alpha.html"),
      toIndexRow(beta, "nome-a-mao.html")
    ];
    let savedRow: any = null;

    invokeMock.mockImplementation((command: string, payload?: any) => {
      if (command === "list_notes") return Promise.resolve(rows);
      if (command === "read_note") {
        return Promise.resolve(
          payload.id === "beta"
            ? serializeNoteToHtmlDocument(beta)
            : serializeNoteToHtmlDocument(alpha, relatedNoteViews(alpha, rows))
        );
      }
      if (command === "save_note") {
        savedRow = payload.row;
        return Promise.resolve();
      }
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await vaultRepository.refreshConnectionProjections();

    expect(savedRow.fileName).toBe("nome-a-mao.html");
  });

  test("um arquivo em conflito é contado e não interrompe a varredura", async () => {
    const { vaultRepository } = await import("@/infrastructure/vaultRepository");
    const rows = [toIndexRow(alpha, "alpha.html"), toIndexRow(beta, "beta.html")];

    invokeMock.mockImplementation((command: string, payload?: any) => {
      if (command === "list_notes") return Promise.resolve(rows);
      if (command === "read_note") return Promise.resolve(serializeNoteToHtmlDocument(beta));
      if (command === "save_note") {
        // Alpha falha fechada, como qualquer gravação sobre arquivo divergente.
        if (payload.row.id === "alpha") {
          return Promise.reject({ code: "vault_external_change" });
        }
        return Promise.resolve();
      }
      return Promise.reject(new Error(`comando inesperado: ${command}`));
    });

    await expect(vaultRepository.refreshConnectionProjections()).resolves.toEqual({
      updated: 1,
      current: 0,
      skipped: 1
    });
  });
});
