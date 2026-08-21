// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import { isHighlightActive, toggleHighlight } from "./highlight";
import { sanitizeNoteContent } from "@/shared/html";

let editor: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = "";
  editor = document.createElement("div");
  editor.contentEditable = "true";
  document.body.append(editor);
});

function select(start: Node, startOffset: number, end: Node = start, endOffset = startOffset) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function firstText(selector: string): Text {
  return editor.querySelector(selector)!.firstChild as Text;
}

describe("toggleHighlight", () => {
  it("destaca apenas o trecho selecionado", () => {
    editor.innerHTML = "<p>uma ideia importante</p>";
    select(firstText("p"), 4, firstText("p"), 9);

    toggleHighlight(editor);

    expect(editor.innerHTML).toBe("<p>uma <mark>ideia</mark> importante</p>");
  });

  it("mantém a seleção sobre o texto destacado", () => {
    editor.innerHTML = "<p>uma ideia</p>";
    select(firstText("p"), 4, firstText("p"), 9);

    toggleHighlight(editor);

    expect(window.getSelection()?.toString()).toBe("ideia");
  });

  it("cria uma marca por bloco quando a seleção atravessa parágrafos", () => {
    editor.innerHTML = "<p>primeira</p><p>segunda</p>";
    const [one, two] = Array.from(editor.querySelectorAll("p"));
    select(one.firstChild!, 3, two.firstChild!, 3);

    toggleHighlight(editor);

    // `mark` é inline: envolver os dois `p` de uma vez produziria HTML inválido.
    expect(editor.innerHTML).toBe(
      "<p>pri<mark>meira</mark></p><p><mark>seg</mark>unda</p>"
    );
  });

  it("remove o destaque quando a seleção já o cobre", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark> boa</p>";
    const mark = editor.querySelector("mark")!;
    select(mark.firstChild!, 0, mark.firstChild!, 5);

    toggleHighlight(editor);

    expect(editor.querySelector("mark")).toBeNull();
    expect(editor.textContent).toBe("uma ideia boa");
  });

  it("remove por inteiro a marca onde o caret está parado", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark> boa</p>";
    select(editor.querySelector("mark")!.firstChild!, 2);

    toggleHighlight(editor);

    expect(editor.innerHTML).toBe("<p>uma ideia boa</p>");
  });

  it("não aninha marcas ao destacar um trecho já destacado", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark> boa</p>";
    const paragraph = editor.querySelector("p")!;
    select(paragraph.firstChild!, 0, paragraph.lastChild!, 4);

    toggleHighlight(editor);

    expect(editor.querySelectorAll("mark")).toHaveLength(0);
  });

  it("ignora o caret sem seleção", () => {
    editor.innerHTML = "<p>uma ideia</p>";
    select(firstText("p"), 3);

    toggleHighlight(editor);

    expect(editor.innerHTML).toBe("<p>uma ideia</p>");
  });

  it("não destaca dentro de um bloco de código", () => {
    editor.innerHTML = "<pre><code>const a = 1;\n</code></pre>";
    const text = editor.querySelector("code")!.firstChild!;
    select(text, 0, text, 5);

    toggleHighlight(editor);

    // O bloco é achatado em texto puro a cada operação; a marca se perderia.
    expect(editor.querySelector("mark")).toBeNull();
  });

  it("ignora uma seleção fora do corpo da nota", () => {
    const outside = document.createElement("p");
    outside.textContent = "outro painel";
    document.body.append(outside);
    editor.innerHTML = "<p>uma ideia</p>";
    select(outside.firstChild!, 0, outside.firstChild!, 5);

    toggleHighlight(editor);

    expect(document.querySelector("mark")).toBeNull();
  });
});

describe("isHighlightActive", () => {
  it("acusa o caret dentro de uma marca", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark></p>";
    select(editor.querySelector("mark")!.firstChild!, 2);

    expect(isHighlightActive(editor)).toBe(true);
  });

  it("não acusa o caret encostado na borda da marca", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark> boa</p>";
    select(editor.querySelector("p")!.lastChild!, 0);

    expect(isHighlightActive(editor)).toBe(false);
  });

  it("acusa uma seleção que cobre parte da marca", () => {
    editor.innerHTML = "<p>uma <mark>ideia</mark> boa</p>";
    const paragraph = editor.querySelector("p")!;
    select(paragraph.firstChild!, 2, paragraph.lastChild!, 2);

    expect(isHighlightActive(editor)).toBe(true);
  });
});

describe("round-trip do arquivo", () => {
  it("mantém a marca na sanitização e descarta seus atributos", () => {
    editor.innerHTML = "<p>uma ideia</p>";
    select(firstText("p"), 4, firstText("p"), 9);
    toggleHighlight(editor);

    expect(sanitizeNoteContent(editor.innerHTML)).toBe("<p>uma <mark>ideia</mark></p>");
    expect(sanitizeNoteContent('<mark style="background:red" onclick="x()">t</mark>')).toBe(
      "<mark>t</mark>"
    );
  });
});
