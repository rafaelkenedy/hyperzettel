/**
 * @vitest-environment jsdom
 *
 * Envelope do arquivo de nota: round-trip Note <-> documento HTML
 * auto-contido. É a fronteira que garante que nenhum campo se perde ao gravar
 * a nota como arquivo e ao lê-la de volta.
 */

import { describe, expect, test } from "vitest";

import { createNoteRecord, type Note } from "@/domain/notes";
import {
  adoptHtmlDocumentAsNote,
  noteFileName,
  parseHtmlDocumentToNote,
  serializeNoteToHtmlDocument
} from "./noteDocument";

function makeNote(over: Partial<Parameters<typeof createNoteRecord>[0]> = {}): Note {
  return createNoteRecord({
    id: "note-1",
    title: "Minha Ideia",
    content: "<p>corpo</p><h2>Seção</h2><p>texto</p>",
    folder: "projects",
    kind: "permanent",
    template: "concept",
    status: "saved",
    recallPrompt: "Como esta ideia funciona sem consultar a nota?",
    connections: [{ id: "note-2", reason: "porque sim" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over
  });
}

describe("serializeNoteToHtmlDocument / parseHtmlDocumentToNote", () => {
  test("round-trip preserva todos os campos", () => {
    const parsed = parseHtmlDocumentToNote(serializeNoteToHtmlDocument(makeNote()));

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("note-1");
    expect(parsed!.title).toBe("Minha Ideia");
    expect(parsed!.folder).toBe("projects");
    expect(parsed!.kind).toBe("permanent");
    expect(parsed!.template).toBe("concept");
    expect(parsed!.status).toBe("saved");
    expect(parsed!.recallPrompt).toBe("Como esta ideia funciona sem consultar a nota?");
    expect(parsed!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed!.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed!.connections).toEqual([{ id: "note-2", reason: "porque sim" }]);
    expect(parsed!.content).toContain("<h2>Seção</h2>");
  });

  test("documento é auto-contido (doctype + head + style)", () => {
    const html = serializeNoteToHtmlDocument(makeNote());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="hz:id" content="note-1">');
    expect(html).toContain(
      '<meta name="hz:recallPrompt" content="Como esta ideia funciona sem consultar a nota?">'
    );
    expect(html).toContain('<meta name="hz:connection" content="note-2|porque sim">');
    expect(html).toContain("<style>");
  });

  test("lista conexões no corpo legível sem incorporá-las ao conteúdo da nota", () => {
    const html = serializeNoteToHtmlDocument(
      makeNote({
        connections: [
          { id: "note-2", reason: "Explica <causa> & efeito." },
          { id: "note-3", reason: "" }
        ]
      })
    );
    const parsed = parseHtmlDocumentToNote(html)!;

    expect(html).toContain('<aside class="hz-connections"');
    expect(html).toContain("Destino: note-2");
    expect(html).toContain("Explica &lt;causa&gt; &amp; efeito.");
    expect(html).toContain("Destino: note-3");
    expect(parsed.connections).toEqual([
      { id: "note-2", reason: "Explica <causa> & efeito." },
      { id: "note-3", reason: "" }
    ]);
    expect(parsed.content).not.toContain("hz-connections");
    expect(parsed.content).not.toContain("Explica");
  });

  test("não renderiza uma seção vazia quando a nota não tem conexões", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ connections: [] }));

    expect(html).not.toContain('<aside class="hz-connections"');
  });

  test("título com caracteres especiais é escapado e volta íntegro", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ title: 'A <b> & "x"' }));

    expect(html).toContain("&lt;b&gt;");
    expect(parseHtmlDocumentToNote(html)!.title).toBe('A <b> & "x"');
  });

  test("arquivos antigos sem pergunta usam o fallback vazio", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ recallPrompt: "" }));

    expect(html).not.toContain('name="hz:recallPrompt"');
    expect(parseHtmlDocumentToNote(html)!.recallPrompt).toBe("");
  });

  test("imagem base64 sobrevive ao round-trip", () => {
    const img = "data:image/webp;base64,UklGRhoAAABXRUJQ";
    const note = makeNote({ content: `<p><img src="${img}" alt="f"></p>` });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.content).toContain(img);
  });

  test("conexão sem motivo faz round-trip", () => {
    const note = makeNote({ connections: [{ id: "note-9", reason: "" }] });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.connections).toEqual([
      { id: "note-9", reason: "" }
    ]);
  });

  test("motivo com barra vertical não corrompe o split", () => {
    const note = makeNote({ connections: [{ id: "note-3", reason: "a | b | c" }] });

    expect(parseHtmlDocumentToNote(serializeNoteToHtmlDocument(note))!.connections).toEqual([
      { id: "note-3", reason: "a | b | c" }
    ]);
  });

  test("documento sem id retorna null", () => {
    expect(
      parseHtmlDocumentToNote("<!doctype html><html><head></head><body></body></html>")
    ).toBeNull();
    expect(parseHtmlDocumentToNote("")).toBeNull();
  });
});

describe("adoptHtmlDocumentAsNote", () => {
  test("adota HTML comum como captura salva e preserva conteúdo seguro", () => {
    const adopted = adoptHtmlDocumentAsNote(
      '<!doctype html><html><head><title>Nota manual</title></head><body><p>Ideia <strong>útil</strong>.</p><script>roubar()</script></body></html>',
      { id: "adopted-1", now: "2026-07-26T20:00:00.000Z" }
    );

    expect(adopted).toMatchObject({
      id: "adopted-1",
      title: "Nota manual",
      folder: "inbox",
      kind: "fleeting",
      template: "blank",
      status: "saved",
      createdAt: "2026-07-26T20:00:00.000Z"
    });
    expect(adopted!.content).toContain("<strong>útil</strong>");
    expect(adopted!.content).not.toContain("script");
  });

  test("não adota documento vazio nem documento que já declara hz:id", () => {
    expect(adoptHtmlDocumentAsNote("")).toBeNull();
    expect(
      adoptHtmlDocumentAsNote(
        '<html><head><meta name="hz:id" content="existente"></head><body><p>x</p></body></html>'
      )
    ).toBeNull();
  });
});

describe("noteFileName", () => {
  test("combina timestamp UTC, título legível e oito caracteres do id", () => {
    expect(
      noteFileName({
        id: "a1b2c3d4-e5f6-4789-abcd-0123456789ab",
        title: "Relações semânticas locais",
        createdAt: "2026-07-26T19:45:30.000Z"
      })
    ).toBe("20260726-194530--relacoes-semanticas-locais--a1b2c3d4.html");
  });

  test("usa valores seguros quando título, data ou id não ajudam", () => {
    expect(
      noteFileName({
        id: "---",
        title: "!!!",
        createdAt: "data inválida"
      })
    ).toBe("00000000-000000--sem-titulo--note.html");
  });
});
