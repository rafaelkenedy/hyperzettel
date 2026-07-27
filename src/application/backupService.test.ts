/**
 * @vitest-environment jsdom
 *
 * Compatibilidade de backup entre as versões do app.
 *
 * A promessa é que um arquivo gerado por qualquer versão anterior entra sem
 * perda. No modelo de arquivo as imagens de backups v2 antigos são
 * embutidas em base64 na importação; estes testes sustentam as duas coisas.
 */

import { describe, expect, test } from "vitest";

import { connectionIds, type Note } from "@/domain/notes";
import type { KnowledgeState, RejectedRelation } from "@/features/knowledge";
import { noteFileName, serializeNoteToHtmlDocument } from "@/shared/noteDocument";
import type { VaultRepository } from "@/infrastructure/vaultRepository";
import { createBackupService } from "./backupService";

/** Vault falso em memória: o serviço recebe a porta por parâmetro. */
function fakeVault() {
  const docs = new Map<string, string>();
  let retention: unknown = null;

  const vault = {
    save: async (note: Note) => {
      docs.set(noteFileName(note), serializeNoteToHtmlDocument(note));
    },
    readAllDocuments: async () =>
      [...docs.entries()].map(([fileName, html]) => ({ fileName, html })),
    setRetention: async (state: unknown) => {
      retention = state;
    }
  } as unknown as VaultRepository;

  return { docs, vault, retention: () => retention };
}

const emptyKnowledge = (): KnowledgeState => ({ version: 1, notes: {}, edges: {} });

function rejectedRelation(
  firstNoteId = "a",
  secondNoteId = "b"
): RejectedRelation {
  return {
    firstNoteId,
    secondNoteId,
    firstContentHash: "a".repeat(64),
    secondContentHash: "b".repeat(64),
    pipelineVersion: "embeddinggemma-2026-07",
    rejectedAt: "2026-07-26T12:00:00Z"
  };
}

function backupFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
}

function createService(
  exportKnowledge = emptyKnowledge,
  exportedRejections: RejectedRelation[] = []
) {
  const { vault, docs, retention } = fakeVault();
  const importedRejections: RejectedRelation[] = [];
  const service = createBackupService({
    vault,
    exportKnowledge,
    exportRejectedRelations: async () => exportedRejections,
    importRejectedRelations: async (rejected) => {
      importedRejections.push(...rejected);
      return rejected.length;
    }
  });
  return {
    service,
    docs,
    retention,
    importedRejections: () => importedRejections
  };
}

describe("importação de formatos antigos", () => {
  test("converte `links` em conexões", async () => {
    const { service } = createService();

    const result = await service.importBackup(
      backupFile({
        format: "hyperzettelkasten",
        version: 2,
        notes: [{ id: "a", title: "Nota", links: ["b", "c"] }]
      })
    );

    expect(connectionIds(result!.notes[0]!.connections)).toEqual(["b", "c"]);
  });

  test("traduz as pastas do esquema numerado", async () => {
    const { service } = createService();

    const result = await service.importBackup(
      backupFile({
        notes: [
          { id: "a", folder: "01 Projects" },
          { id: "b", folder: "05 Daily" },
          { id: "c", folder: "00 Inbox" }
        ]
      })
    );

    expect(result!.notes.map((note) => note.folder)).toEqual(["projects", "journal", "inbox"]);
  });

  test("deduz o estágio quando o arquivo não traz", async () => {
    const { service } = createService();

    const result = await service.importBackup(
      backupFile({ notes: [{ id: "a", template: "concept" }] })
    );

    expect(result!.notes[0]!.kind).toBe("permanent");
  });

  test("tudo que vem de backup entra como nota salva", async () => {
    const { service } = createService();

    const result = await service.importBackup(backupFile({ notes: [{ id: "a" }] }));

    expect(result!.notes[0]!.status).toBe("saved");
  });

  test("aceita um array solto de notas", async () => {
    const { service } = createService();

    const result = await service.importBackup(backupFile([{ id: "a", title: "Solta" }]));

    expect(result!.notes).toHaveLength(1);
  });

  test("devolve o histórico de aprendizagem embutido", async () => {
    const { service } = createService();
    const knowledge = { version: 1, notes: { a: { reviewCount: 3 } }, edges: {} };

    const result = await service.importBackup(backupFile({ notes: [{ id: "a" }], knowledge }));

    expect(result!.knowledge).toEqual(knowledge);
  });

  test("backup antigo sem rejeições continua compatível", async () => {
    const { service, importedRejections } = createService();

    const result = await service.importBackup(backupFile({ version: 2, notes: [{ id: "a" }] }));

    expect(result!.rejectedRelationCount).toBe(0);
    expect(importedRejections()).toEqual([]);
  });

  test("restaura decisões de relações semânticas do formato v3", async () => {
    const { service, importedRejections } = createService();
    const rejected = rejectedRelation();

    const result = await service.importBackup(
      backupFile({
        format: "hyperzettelkasten",
        version: 3,
        notes: [{ id: "a" }, { id: "b" }],
        rejectedRelations: [rejected]
      })
    );

    expect(result!.rejectedRelationCount).toBe(1);
    expect(importedRejections()).toEqual([rejected]);
  });

  test("grava as notas importadas no vault", async () => {
    const { service, docs } = createService();

    await service.importBackup(backupFile({ notes: [{ id: "a" }, { id: "b" }] }));

    expect(docs.size).toBe(2);
  });

  test("embute imagens de backup v2 (data-image-id) como base64", async () => {
    const { service, docs } = createService();
    const image = "data:image/webp;base64,UklGRhoAAABXRUJQ";

    const result = await service.importBackup(
      backupFile({
        format: "hyperzettelkasten",
        version: 2,
        notes: [{ id: "a", title: "Com imagem", content: '<p><img data-image-id="x"></p>' }],
        images: [{ id: "x", data: image }]
      })
    );

    const document = docs.get(noteFileName(result!.notes[0]!));
    expect(document).toContain(image);
    expect(document).not.toContain("data-image-id");
  });
});

describe("recusas", () => {
  test("rejeita formato desconhecido", async () => {
    const { service } = createService();

    await expect(
      service.importBackup(backupFile({ format: "outro-app", notes: [] }))
    ).rejects.toThrow(/Formato de backup não reconhecido/);
  });

  test("rejeita arquivo sem coleção de notas", async () => {
    const { service } = createService();

    await expect(service.importBackup(backupFile({ notes: "nada" }))).rejects.toThrow(
      /coleção de notas válida/
    );
  });

  test("rejeita quando nenhuma nota do arquivo é aproveitável", async () => {
    const { service } = createService();

    await expect(service.importBackup(backupFile({ notes: [null, 42] }))).rejects.toThrow(
      /Nenhuma nota válida/
    );
  });

  test("rejeita decisão semântica inconsistente antes de gravar notas", async () => {
    const { service, docs } = createService();

    await expect(
      service.importBackup(
        backupFile({
          version: 3,
          notes: [{ id: "a" }, { id: "b" }],
          rejectedRelations: [{ ...rejectedRelation(), firstContentHash: "curto" }]
        })
      )
    ).rejects.toThrow(/decisão semântica inconsistente/);
    expect(docs.size).toBe(0);
  });

  test("arquivo ausente não é erro, apenas não faz nada", async () => {
    const { service } = createService();

    expect(await service.importBackup(null)).toBeNull();
  });
});

describe("exportação", () => {
  test("não anuncia backup completo quando um HTML grande foi isolado", async () => {
    const vault = {
      readAllDocuments: async () => [
        {
          fileName: "grande.html",
          html: null,
          contentHash: "oversized:30000000",
          sizeBytes: 30_000_000,
          maxBytes: 26_214_400
        }
      ]
    } as unknown as VaultRepository;
    const service = createBackupService({
      vault,
      exportKnowledge: emptyKnowledge,
      exportRejectedRelations: async () => [],
      importRejectedRelations: async () => 0
    });

    await expect(service.exportBackup()).rejects.toThrow(
      /backup não foi exportado.*excedem o limite de 25 MB/i
    );
  });

  test("declara o formato atual e embute o histórico", async () => {
    const knowledge: KnowledgeState = {
      version: 1,
      notes: {
        a: {
          createdAt: "2026-01-01T00:00:00.000Z",
          baselineAt: "2026-01-01T00:00:00.000Z",
          lastReviewedAt: null,
          dueAt: null,
          easeFactor: 2.5,
          repetitions: 0,
          intervalDays: 3,
          reviewCount: 0,
          history: []
        }
      },
      edges: {}
    };
    const { service } = createService(() => knowledge);

    await service.importBackup(backupFile({ notes: [{ id: "a", title: "Uma" }] }));
    const result = await service.exportBackup();
    const parsed = JSON.parse(result.contents);

    expect(parsed.format).toBe("hyperzettelkasten");
    expect(parsed.version).toBe(3);
    expect(parsed.knowledge).toEqual(knowledge);
    expect(parsed.rejectedRelations).toEqual([]);
    expect(result.noteCount).toBe(1);
    expect(result.rejectedRelationCount).toBe(0);
  });

  test("inclui rejeições semânticas e preserva no round-trip", async () => {
    const rejected = rejectedRelation();
    const { service } = createService(emptyKnowledge, [rejected]);
    await service.importBackup(backupFile({ notes: [{ id: "a" }, { id: "b" }] }));

    const exported = await service.exportBackup();
    const { service: other, importedRejections } = createService();
    const imported = await other.importBackup(
      new File([exported.contents], "backup.json", { type: "application/json" })
    );

    expect(exported.rejectedRelationCount).toBe(1);
    expect(imported!.rejectedRelationCount).toBe(1);
    expect(importedRejections()).toEqual([rejected]);
  });

  test("o que sai volta a entrar sem perda", async () => {
    const { service } = createService();

    await service.importBackup(
      backupFile({
        notes: [
          {
            id: "a",
            title: "Ida e volta",
            folder: "02 Areas",
            links: ["b"],
            template: "concept"
          }
        ]
      })
    );

    const exported = await service.exportBackup();
    const { service: outro } = createService();
    const reimported = await outro.importBackup(
      new File([exported.contents], "backup.json", { type: "application/json" })
    );

    const note = reimported!.notes[0]!;
    expect(note.title).toBe("Ida e volta");
    expect(note.folder).toBe("areas");
    expect(note.kind).toBe("permanent");
    expect(connectionIds(note.connections)).toEqual(["b"]);
  });
});
