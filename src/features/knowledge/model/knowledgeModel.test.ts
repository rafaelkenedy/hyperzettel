/**
 * Modelo de conhecimento: sincronia com a coleção, revisão e agendamento.
 *
 * Aqui mora o único dado do app que não dá para reconstruir a partir das
 * notas — o histórico de revisões. Os testes cobrem principalmente o que
 * poderia corrompê-lo em silêncio.
 */

import { describe, expect, test } from "vitest";

import { createNoteRecord, type Note } from "@/domain/notes";
import {
  createKnowledgeModel,
  isReviewDue,
  normalizeKnowledgeState
} from "./knowledgeModel";
import { policy } from "./retention";
import { SM2 } from "./scheduler";

const DAY = 86_400_000;

function note(id: string, connections: string[] = []): Note {
  return createNoteRecord({
    id,
    title: `Nota ${id}`,
    folder: "resources",
    kind: "permanent",
    status: "saved",
    connections,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
}

describe("sync", () => {
  test("cria estado para cada nota e aresta", () => {
    const model = createKnowledgeModel(null);
    const snapshot = model.sync([note("a", ["b"]), note("b")]);

    expect(snapshot.notes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
  });

  test("uma aresta é única mesmo quando as duas pontas se declaram", () => {
    const model = createKnowledgeModel(null);
    const snapshot = model.sync([note("a", ["b"]), note("b", ["a"])]);

    expect(snapshot.edges).toHaveLength(1);
  });

  test("descarta o estado de notas que deixaram de existir", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a"), note("b")]);

    const snapshot = model.sync([note("a")]);
    expect(snapshot.notes.map((item) => item.id)).toEqual(["a"]);
    expect(model.noteInfo("b")).toBeNull();
  });

  test("ignora conexão para nota inexistente e auto-referência", () => {
    const model = createKnowledgeModel(null);
    const snapshot = model.sync([note("a", ["a", "fantasma"])]);

    expect(snapshot.edges).toEqual([]);
  });

  test("sincronizar de novo não recria o estado já existente", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);
    model.reviewNote("a", 4);

    const before = model.noteInfo("a")!.reviewCount;
    model.sync([note("a")]);

    expect(model.noteInfo("a")!.reviewCount).toBe(before);
  });

  test("inicia a retenção quando um rascunho se torna revisável", () => {
    const model = createKnowledgeModel(null);
    const createdAt = "2026-01-01T00:00:00.000Z";
    const completedAt = "2026-05-01T12:00:00.000Z";
    const draft = {
      ...note("tardia"),
      status: "draft" as const,
      updatedAt: createdAt
    };

    model.sync([draft], Date.parse(createdAt));
    model.sync(
      [{ ...draft, status: "saved", updatedAt: completedAt }],
      Date.parse(completedAt)
    );

    const info = model.noteInfo("tardia", Date.parse(completedAt))!;
    expect(info.baselineAt).toBe(completedAt);
    expect(info.strength).toBeCloseTo(1, 5);
    expect(model.snapshot(Date.parse(completedAt)).metrics.reviewDue).toBe(0);
  });

  test("não reinicia histórico quando uma nota revisada volta a ficar elegível", () => {
    const model = createKnowledgeModel(null);
    const reviewedAt = "2026-02-01T00:00:00.000Z";
    model.sync([note("a")], Date.parse("2026-01-01T00:00:00.000Z"));
    model.reviewNote("a", 4, reviewedAt);

    model.sync(
      [{ ...note("a"), kind: "fleeting", updatedAt: "2026-03-01T00:00:00.000Z" }],
      Date.parse("2026-03-01T00:00:00.000Z")
    );
    model.sync(
      [{ ...note("a"), updatedAt: "2026-04-01T00:00:00.000Z" }],
      Date.parse("2026-04-01T00:00:00.000Z")
    );

    const info = model.noteInfo("a")!;
    expect(info.reviewCount).toBe(1);
    expect(info.lastReviewedAt).toBe(reviewedAt);
    expect(info.dueAt).toBe(new Date(Date.parse(reviewedAt) + DAY).toISOString());
  });
});

describe("reviewNote", () => {
  test("agenda pelo SM-2 e registra a data de vencimento", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    const at = "2026-05-01T12:00:00.000Z";
    const result = model.reviewNote("a", 4, at);

    expect(result.ok).toBe(true);
    const info = model.noteInfo("a")!;
    expect(info.repetitions).toBe(1);
    expect(info.intervalDays).toBe(SM2.firstInterval);
    expect(info.dueAt).toBe(new Date(Date.parse(at) + DAY).toISOString());
  });

  test("reforça as conexões ligadas à nota revisada", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a", ["b"]), note("b"), note("c")]);

    const result = model.reviewNote("a", 4);

    expect(result.ok && !result.repeated && result.reinforcedEdges).toBe(1);
  });

  test("ignora revisão repetida dentro da janela", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    const at = "2026-05-01T12:00:00.000Z";
    model.reviewNote("a", 4, at);
    const segundo = model.reviewNote("a", 4, new Date(Date.parse(at) + 1000).toISOString());

    expect(segundo.ok && segundo.repeated).toBe(true);
    expect(model.noteInfo("a")!.reviewCount).toBe(1);
  });

  test("responder mal reinicia a escada e reduz a facilidade", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    let at = Date.parse("2026-05-01T12:00:00.000Z");
    const avancar = (quality: 1 | 4) => {
      at += 10 * DAY;
      model.reviewNote("a", quality, new Date(at).toISOString());
    };

    avancar(4);
    avancar(4);
    avancar(4);
    const antes = model.noteInfo("a")!;
    expect(antes.repetitions).toBe(3);

    avancar(1);
    const depois = model.noteInfo("a")!;
    expect(depois.repetitions).toBe(0);
    expect(depois.intervalDays).toBe(1);
    expect(depois.easeFactor).toBeLessThan(antes.easeFactor);
  });

  test("acusa nota fora do mapa", () => {
    const model = createKnowledgeModel(null);
    expect(model.reviewNote("inexistente", 4)).toEqual({ ok: false, reason: "missing" });
  });

  test("guarda a qualidade no histórico", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);
    model.reviewNote("a", 5, "2026-05-01T12:00:00.000Z");

    expect(model.noteInfo("a")!.history.at(-1)!.quality).toBe(5);
  });
});

describe("retenção", () => {
  test("cai para 50% exatamente quando a revisão vence", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    const at = Date.parse("2026-05-01T12:00:00.000Z");
    model.reviewNote("a", 4, new Date(at).toISOString());

    const intervalo = model.noteInfo("a")!.intervalDays;
    const noVencimento = model.noteInfo("a", at + intervalo * DAY)!;

    expect(noVencimento.strength).toBeCloseTo(0.5, 5);
  });

  test("uma nota nunca revisada decai a partir da própria data", () => {
    const model = createKnowledgeModel(null);
    const at = Date.parse("2026-01-01T00:00:00.000Z");
    model.sync([note("a")], at);

    expect(model.noteInfo("a", at)!.strength).toBeCloseTo(1, 5);
    expect(
      model.noteInfo("a", at + policy.initialNoteInterval * DAY)!.strength
    ).toBeCloseTo(0.5, 5);
  });
});

describe("estado persistido", () => {
  test("aceita o formato anterior, com stabilityDays", () => {
    const state = normalizeKnowledgeState({
      version: 1,
      notes: {
        a: {
          createdAt: "2026-01-01T00:00:00.000Z",
          baselineAt: "2026-01-01T00:00:00.000Z",
          stabilityDays: 5.4,
          reviewCount: 1,
          history: []
        }
      },
      edges: {}
    });

    // O intervalo herda a estabilidade antiga; a facilidade começa no padrão
    // porque a qualidade das revisões passadas nunca foi registrada.
    expect(state.notes.a!.intervalDays).toBe(5.4);
    expect(state.notes.a!.easeFactor).toBe(SM2.initialEase);
    expect(state.notes.a!.reviewCount).toBe(1);
  });

  test("descarta aresta malformada", () => {
    const state = normalizeKnowledgeState({
      version: 1,
      notes: {},
      edges: { ruim: { a: "x", b: "x" }, sem: { a: "x" } }
    });

    expect(Object.keys(state.edges)).toEqual([]);
  });

  test("exportar e reimportar preserva o histórico", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);
    model.reviewNote("a", 5, "2026-05-01T12:00:00.000Z");

    const restaurado = createKnowledgeModel(model.exportState());
    restaurado.sync([note("a")]);

    expect(restaurado.noteInfo("a")!.reviewCount).toBe(1);
    expect(restaurado.noteInfo("a")!.history).toHaveLength(1);
  });

  test("importar mesclando mantém o que já existia", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a"), note("b")]);
    model.reviewNote("a", 4, "2026-05-01T12:00:00.000Z");

    const outro = createKnowledgeModel(null);
    outro.sync([note("b")]);
    outro.reviewNote("b", 4, "2026-05-02T12:00:00.000Z");

    model.importState(outro.exportState(), true);
    model.sync([note("a"), note("b")]);

    expect(model.noteInfo("a")!.reviewCount).toBe(1);
    expect(model.noteInfo("b")!.reviewCount).toBe(1);
  });

  test("importar sem mesclar substitui o estado", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);
    model.reviewNote("a", 4, "2026-05-01T12:00:00.000Z");

    model.importState({ version: 1, notes: {}, edges: {} });
    model.sync([note("a")]);

    expect(model.noteInfo("a")!.reviewCount).toBe(0);
  });
});

describe("métricas e curva", () => {
  test("centraliza a regra que decide se uma nota está vencida", () => {
    const at = Date.parse("2026-05-01T12:00:00.000Z");
    const base = {
      kind: "permanent" as const,
      status: "saved" as const,
      dueAt: null,
      strength: 0.6
    };

    expect(isReviewDue(base, at)).toBe(false);
    expect(isReviewDue({ ...base, strength: 0.54 }, at)).toBe(true);
    expect(
      isReviewDue({ ...base, dueAt: "2026-05-02T12:00:00.000Z" }, at)
    ).toBe(false);
    expect(
      isReviewDue({ ...base, dueAt: "2026-04-30T12:00:00.000Z" }, at)
    ).toBe(true);
    expect(isReviewDue({ ...base, status: "draft", strength: 0.1 }, at)).toBe(false);
    expect(isReviewDue({ ...base, kind: "fleeting", strength: 0.1 }, at)).toBe(false);
  });

  test("conta como vencida a nota cujo prazo passou", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    const at = Date.parse("2026-05-01T12:00:00.000Z");
    model.reviewNote("a", 4, new Date(at).toISOString());

    expect(model.snapshot(at).metrics.reviewDue).toBe(0);
    expect(model.snapshot(at + 2 * DAY).metrics.reviewDue).toBe(1);
  });

  test("não inclui rascunhos nem capturas fugazes na fila de revisão", () => {
    const model = createKnowledgeModel(null);
    model.sync([
      note("permanente"),
      { ...note("rascunho"), status: "draft" },
      { ...note("captura"), kind: "fleeting" }
    ]);

    const muchLater = Date.parse("2027-01-01T00:00:00.000Z");
    expect(model.snapshot(muchLater).metrics.reviewDue).toBe(1);
    expect(model.reviewNote("rascunho", 4)).toEqual({ ok: false, reason: "ineligible" });
    expect(model.reviewNote("captura", 4)).toEqual({ ok: false, reason: "ineligible" });
  });

  test("a curva devolve um ponto por dia do período", () => {
    const model = createKnowledgeModel(null);
    model.sync([note("a")]);

    expect(model.curve(30)).toHaveLength(31);
  });
});
