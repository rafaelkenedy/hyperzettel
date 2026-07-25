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
    expect(parsed!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed!.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(parsed!.connections).toEqual([{ id: "note-2", reason: "porque sim" }]);
    expect(parsed!.content).toContain("<h2>Seção</h2>");
  });

  test("documento é auto-contido (doctype + head + style)", () => {
    const html = serializeNoteToHtmlDocument(makeNote());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta name="hz:id" content="note-1">');
    expect(html).toContain('<meta name="hz:connection" content="note-2|porque sim">');
    expect(html).toContain("<style>");
  });

  test("título com caracteres especiais é escapado e volta íntegro", () => {
    const html = serializeNoteToHtmlDocument(makeNote({ title: 'A <b> & "x"' }));

    expect(html).toContain("&lt;b&gt;");
    expect(parseHtmlDocumentToNote(html)!.title).toBe('A <b> & "x"');
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

describe("noteFileName", () => {
  test("usa o id como nome, estável a renomeações de título", () => {
    expect(noteFileName({ id: "abc" })).toBe("abc.html");
  });
});
