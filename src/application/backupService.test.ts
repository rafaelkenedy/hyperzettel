/**
 * @vitest-environment jsdom
 *
 * Compatibilidade de backup entre as versões do app.
 *
 * A promessa é que um arquivo gerado por qualquer versão anterior entra sem
 * perda. Estes testes são o que sustenta essa afirmação.
 */

import { describe, expect, test } from "vitest";

import { connectionIds, type Note } from "@/domain/notes";
import type { KnowledgeState } from "@/features/knowledge";
import type { NoteRepository, StoredImage } from "@/infrastructure/noteRepository";
import { createBackupService } from "./backupService";

/** Repositório em memória: o serviço recebe a porta por parâmetro. */
function fakeRepository() {
  const notes = new Map<string, Note>();
  const images = new Map<string, StoredImage>();

  return {
    notes,
    images,
    repository: {
      putNote: async (note: Note) => {
        notes.set(note.id, note);
        return note.id;
      },
      putImage: async (image: StoredImage) => {
        images.set(image.id, image);
        return image.id;
      },
      getAllNotes: async () => [...notes.values()],
      getAllImages: async () => [...images.values()]
    } as unknown as NoteRepository
  };
}

const emptyKnowledge = (): KnowledgeState => ({ version: 1, notes: {}, edges: {} });

function backupFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], "backup.json", { type: "application/json" });
}

function createService(exportKnowledge = emptyKnowledge) {
  const { repository, notes } = fakeRepository();
  return { service: createBackupService({ repository, exportKnowledge }), notes };
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

  test("grava as notas importadas no repositório", async () => {
    const { service, notes } = createService();

    await service.importBackup(backupFile({ notes: [{ id: "a" }, { id: "b" }] }));

    expect(notes.size).toBe(2);
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

  test("arquivo ausente não é erro, apenas não faz nada", async () => {
    const { service } = createService();

    expect(await service.importBackup(null)).toBeNull();
  });
});

describe("exportação", () => {
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
    const parsed = JSON.parse(await result.blob.text());

    expect(parsed.format).toBe("hyperzettelkasten");
    expect(parsed.version).toBe(2);
    expect(parsed.knowledge).toEqual(knowledge);
    expect(result.noteCount).toBe(1);
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
      new File([await exported.blob.text()], "backup.json", { type: "application/json" })
    );

    const note = reimported!.notes[0]!;
    expect(note.title).toBe("Ida e volta");
    expect(note.folder).toBe("areas");
    expect(note.kind).toBe("permanent");
    expect(connectionIds(note.connections)).toEqual(["b"]);
  });
});
