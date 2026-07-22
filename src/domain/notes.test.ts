/**
 * Regras de notas, pastas, conexões e filtros.
 *
 * O foco é o que dá para escrever errado sem o compilador reclamar: formatos
 * antigos que ainda chegam por backup, bidirecionalidade das conexões e os
 * casos de borda da migração.
 */

import { describe, expect, test } from "vitest";

import {
  ALL_SCOPE,
  connectionIds,
  countByFolder,
  countByKind,
  createConnectionCounts,
  createNoteRecord,
  filterAndSort,
  findRelations,
  hasMeaningfulContent,
  matchesScope,
  mergeNote,
  needsMigration,
  normalizeConnections,
  normalizeImportedNote,
  resolvePersistedStatus,
  scopeLabel,
  type Note
} from "./notes";

/** Texto puro sem DOM: o domínio recebe essa função por parâmetro. */
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

describe("resolvePersistedStatus", () => {
  test("autosave preserva uma nota já concluída", () => {
    expect(resolvePersistedStatus("draft", "saved")).toBe("saved");
  });

  test("rascunho só é concluído por gravação explícita", () => {
    expect(resolvePersistedStatus("draft", "draft")).toBe("draft");
    expect(resolvePersistedStatus("saved", "draft")).toBe("saved");
  });
});

function note(overrides: Partial<Note> & { id: string }): Note {
  return createNoteRecord({ status: "saved", ...overrides });
}

describe("normalizeConnections", () => {
  test("aceita o formato antigo de ids soltos", () => {
    expect(normalizeConnections(["a", "b"])).toEqual([
      { id: "a", reason: "" },
      { id: "b", reason: "" }
    ]);
  });

  test("preserva o motivo já escrito", () => {
    expect(normalizeConnections([{ id: "a", reason: "contrasta com a outra" }])).toEqual([
      { id: "a", reason: "contrasta com a outra" }
    ]);
  });

  test("remove duplicatas mantendo o primeiro motivo não vazio", () => {
    const result = normalizeConnections([
      { id: "a", reason: "" },
      { id: "a", reason: "explicação que veio depois" }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe("explicação que veio depois");
  });

  test("descarta entradas sem id utilizável", () => {
    expect(normalizeConnections(["  ", null, 42, { reason: "sem destino" }])).toEqual([]);
  });

  test("devolve lista vazia para valores que não são array", () => {
    expect(normalizeConnections(undefined)).toEqual([]);
    expect(normalizeConnections("a,b")).toEqual([]);
  });
});

describe("createNoteRecord", () => {
  test("deduz o estágio a partir do modelo quando ele não vem", () => {
    expect(note({ id: "1", template: "concept" }).kind).toBe("permanent");
    expect(note({ id: "2", template: "reference" }).kind).toBe("source");
    expect(note({ id: "3", template: "project" }).kind).toBe("structure");
    expect(note({ id: "4", template: "daily" }).kind).toBe("fleeting");
  });

  test("um estágio explícito vence a dedução", () => {
    expect(note({ id: "1", template: "concept", kind: "fleeting" }).kind).toBe("fleeting");
  });

  test("cai nos padrões diante de valores desconhecidos", () => {
    const record = note({ id: "1", folder: "inexistente", template: "nada", kind: "outro" });

    expect(record.folder).toBe("inbox");
    expect(record.template).toBe("blank");
    expect(record.kind).toBe("fleeting");
  });

  test("título vazio vira 'Sem título'", () => {
    expect(note({ id: "1", title: "   " }).title).toBe("Sem título");
  });
});

describe("normalizeImportedNote", () => {
  const options = { sanitizeContent: (value: unknown) => String(value ?? "") };

  test("lê `links` dos backups antigos como conexões", () => {
    const imported = normalizeImportedNote(
      { id: "a", title: "Nota", links: ["b", "c"] },
      options
    );

    expect(connectionIds(imported!.connections)).toEqual(["b", "c"]);
  });

  test("`connections` tem precedência sobre `links`", () => {
    const imported = normalizeImportedNote(
      { id: "a", connections: [{ id: "novo", reason: "" }], links: ["antigo"] },
      options
    );

    expect(connectionIds(imported!.connections)).toEqual(["novo"]);
  });

  test("rejeita o que não é objeto de nota", () => {
    expect(normalizeImportedNote(null, options)).toBeNull();
    expect(normalizeImportedNote([1, 2], options)).toBeNull();
    expect(normalizeImportedNote("nota", options)).toBeNull();
  });

  test("gera id quando o arquivo não traz um", () => {
    const imported = normalizeImportedNote({ title: "Sem id" }, options);
    expect(imported!.id).toBeTruthy();
  });
});

describe("needsMigration", () => {
  test("acusa registro sem estágio", () => {
    expect(needsMigration({ id: "a", connections: [] })).toBe(true);
  });

  test("acusa conexões ainda em formato de id solto", () => {
    expect(needsMigration({ id: "a", kind: "permanent", connections: ["b"] })).toBe(true);
  });

  test("não acusa registro já no contrato atual", () => {
    expect(
      needsMigration({ id: "a", kind: "permanent", connections: [{ id: "b", reason: "" }] })
    ).toBe(false);
  });
});

describe("createConnectionCounts", () => {
  test("conta nos dois sentidos a partir de um único link", () => {
    const counts = createConnectionCounts([
      note({ id: "a", connections: ["b"] }),
      note({ id: "b" })
    ]);

    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
  });

  test("não conta duas vezes quando as duas pontas se declaram", () => {
    const counts = createConnectionCounts([
      note({ id: "a", connections: ["b"] }),
      note({ id: "b", connections: ["a"] })
    ]);

    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
  });

  test("ignora auto-referência e destino inexistente", () => {
    const counts = createConnectionCounts([note({ id: "a", connections: ["a", "fantasma"] })]);
    expect(counts.get("a")).toBe(0);
  });
});

describe("findRelations", () => {
  test("uma nota citada nos dois sentidos aparece uma vez só", () => {
    const relations = findRelations(
      [
        note({ id: "a", connections: [{ id: "b", reason: "daqui pra lá" }] }),
        note({ id: "b", connections: [{ id: "a", reason: "de lá pra cá" }] })
      ],
      "a"
    );

    expect(relations).toHaveLength(1);
    expect(relations[0]!.direction).toBe("mutual");
    expect(relations[0]!.reason).toBe("daqui pra lá");
    expect(relations[0]!.incomingReason).toBe("de lá pra cá");
  });

  test("distingue o que esta nota declarou do que só recebeu", () => {
    const collection = [
      note({ id: "a", connections: ["saida"] }),
      note({ id: "saida" }),
      note({ id: "entrada", connections: ["a"] })
    ];

    const porId = Object.fromEntries(
      findRelations(collection, "a").map((item) => [item.note.id, item.direction])
    );

    expect(porId.saida).toBe("outgoing");
    expect(porId.entrada).toBe("incoming");
  });

  test("mútuas vêm antes das que só chegam", () => {
    const relations = findRelations(
      [
        note({ id: "a", connections: ["m"] }),
        note({ id: "m", connections: ["a"] }),
        note({ id: "e", connections: ["a"] })
      ],
      "a"
    );

    expect(relations.map((item) => item.note.id)).toEqual(["m", "e"]);
  });

  test("a nota não se relaciona consigo mesma", () => {
    expect(findRelations([note({ id: "a", connections: ["a"] })], "a")).toEqual([]);
  });

  test("conexão para nota inexistente não vira relação", () => {
    expect(findRelations([note({ id: "a", connections: ["fantasma"] })], "a")).toEqual([]);
  });
});

describe("filterAndSort", () => {
  const collection = [
    note({ id: "a", title: "Arrays", folder: "resources", kind: "permanent", updatedAt: "2026-01-01T00:00:00.000Z" }),
    note({ id: "b", title: "Ponteiros", folder: "inbox", kind: "fleeting", updatedAt: "2026-03-01T00:00:00.000Z" }),
    note({ id: "c", title: "Listas", folder: "resources", kind: "fleeting", updatedAt: "2026-02-01T00:00:00.000Z" })
  ];

  test("ordena da mais recente para a mais antiga", () => {
    const result = filterAndSort(collection, { scope: ALL_SCOPE, toPlainText: plain });
    expect(result.map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  test("filtra por pasta e por estágio", () => {
    expect(
      filterAndSort(collection, { scope: { kind: "folder", value: "resources" }, toPlainText: plain })
        .map((item) => item.id)
    ).toEqual(["c", "a"]);

    expect(
      filterAndSort(collection, { scope: { kind: "kind", value: "fleeting" }, toPlainText: plain })
        .map((item) => item.id)
    ).toEqual(["b", "c"]);
  });

  test("busca no título e no conteúdo, ignorando acento de caixa", () => {
    const withBody = [note({ id: "x", title: "Nada", content: "<p>fala de PONTEIROS</p>" })];

    expect(
      filterAndSort(withBody, { query: "ponteiros", toPlainText: plain }).map((item) => item.id)
    ).toEqual(["x"]);
  });

  test("busca vazia não filtra nada", () => {
    expect(filterAndSort(collection, { query: "   ", toPlainText: plain })).toHaveLength(3);
  });
});

describe("hasMeaningfulContent", () => {
  test("uma conexão sozinha já torna a nota digna de gravação", () => {
    expect(hasMeaningfulContent({ connections: ["outra"] }, plain)).toBe(true);
  });

  test("rascunho totalmente vazio não é gravado", () => {
    expect(hasMeaningfulContent({ title: "  ", content: "<p></p>", connections: [] }, plain)).toBe(
      false
    );
  });
});

describe("contagens e escopo", () => {
  const collection = [
    note({ id: "a", folder: "inbox", kind: "fleeting" }),
    note({ id: "b", folder: "resources", kind: "permanent" }),
    note({ id: "c", folder: "resources", kind: "permanent" })
  ];

  test("conta por pasta incluindo o total", () => {
    const counts = countByFolder(collection);
    expect(counts.all).toBe(3);
    expect(counts.resources).toBe(2);
    expect(counts.archive).toBe(0);
  });

  test("conta por estágio", () => {
    expect(countByKind(collection).permanent).toBe(2);
  });

  test("o escopo 'todas' aceita qualquer nota", () => {
    expect(matchesScope(collection[0]!, ALL_SCOPE)).toBe(true);
    expect(scopeLabel(ALL_SCOPE)).toBe("Todas as notas");
    expect(scopeLabel({ kind: "kind", value: "permanent" })).toBe("Permanente");
  });
});

describe("mergeNote", () => {
  test("substitui a nota existente em vez de duplicar", () => {
    const collection = [note({ id: "a", title: "Antes" })];
    const merged = mergeNote(collection, note({ id: "a", title: "Depois" }));

    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe("Depois");
  });

  test("não altera o array original", () => {
    const collection = [note({ id: "a" })];
    mergeNote(collection, note({ id: "b" }));
    expect(collection).toHaveLength(1);
  });
});
