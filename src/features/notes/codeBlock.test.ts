// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  activeCodeBlock,
  handleCodeBlockKeyDown,
  insertTextInCodeBlock,
  toggleCodeBlock
} from "./codeBlock";
import { sanitizeNoteContent } from "@/shared/html";

let editor: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = "";
  editor = document.createElement("div");
  editor.contentEditable = "true";
  document.body.append(editor);
});

/** Coloca o caret em um offset de um nó de texto do editor. */
function placeCaret(node: Node, offset: number, endOffset = offset) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function codeText(): string {
  return editor.querySelector("pre code")?.textContent ?? "";
}

function caretOffset(): number {
  return window.getSelection()?.getRangeAt(0).startOffset ?? -1;
}

const enter = { key: "Enter", shiftKey: false };

describe("toggleCodeBlock", () => {
  it("cria um bloco vazio com o caret dentro dele", () => {
    editor.innerHTML = "<p>ideia</p>";
    placeCaret(editor.querySelector("p")!.firstChild!, 5);

    toggleCodeBlock(editor);

    expect(editor.querySelector("pre > code")).not.toBeNull();
    // Só o sentinela: o bloco começa vazio para a pessoa digitar.
    expect(codeText()).toBe("\n");
    expect(activeCodeBlock(editor)).toBe(editor.querySelector("pre"));
  });

  it("substitui um parágrafo vazio em vez de deixá-lo órfão", () => {
    editor.innerHTML = "<p><br></p>";
    placeCaret(editor.querySelector("p")!, 0);

    toggleCodeBlock(editor);

    expect(editor.querySelectorAll("p")).toHaveLength(1); // apenas o de saída
    expect(editor.firstElementChild?.tagName).toBe("PRE");
  });

  it("converte a seleção em conteúdo do bloco", () => {
    editor.innerHTML = "<p>npm run tauri dev</p>";
    placeCaret(editor.querySelector("p")!.firstChild!, 0, 17);

    toggleCodeBlock(editor);

    expect(codeText()).toBe("npm run tauri dev\n");
    expect(caretOffset()).toBe(17);
  });

  it("garante um bloco depois do código para continuar escrevendo", () => {
    placeCaret(editor, 0);

    toggleCodeBlock(editor);

    expect(editor.querySelector("pre")?.nextElementSibling?.tagName).toBe("P");
  });

  it("desfaz o bloco devolvendo uma linha por parágrafo", () => {
    editor.innerHTML = "<pre><code>uma\nduas\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 0);

    toggleCodeBlock(editor);

    expect(editor.querySelector("pre")).toBeNull();
    expect(Array.from(editor.querySelectorAll("p")).map((p) => p.textContent)).toEqual([
      "uma",
      "duas"
    ]);
  });
});

describe("handleCodeBlockKeyDown", () => {
  it("ignora teclas fora de um bloco de código", () => {
    editor.innerHTML = "<p>texto</p>";
    placeCaret(editor.querySelector("p")!.firstChild!, 5);

    expect(handleCodeBlockKeyDown(enter, editor)).toBe(false);
  });

  it("quebra a linha dentro do bloco em vez de sair dele", () => {
    editor.innerHTML = "<pre><code>const a = 1;\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 12);

    expect(handleCodeBlockKeyDown(enter, editor)).toBe(true);
    expect(codeText()).toBe("const a = 1;\n\n");
    expect(caretOffset()).toBe(13);
    expect(editor.querySelector("pre")).not.toBeNull();
  });

  it("quebra a linha também no meio do código", () => {
    editor.innerHTML = "<pre><code>ab\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 1);

    handleCodeBlockKeyDown(enter, editor);

    expect(codeText()).toBe("a\nb\n");
    expect(caretOffset()).toBe(2);
  });

  it("sai do bloco no segundo Enter da última linha vazia", () => {
    editor.innerHTML = "<pre><code>fim\n\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 4);

    expect(handleCodeBlockKeyDown(enter, editor)).toBe(true);
    // A linha vazia de saída não fica no conteúdo.
    expect(codeText()).toBe("fim\n");
    expect(editor.querySelector("pre")?.nextElementSibling?.tagName).toBe("P");
  });

  it("remove um bloco vazio ao sair dele", () => {
    editor.innerHTML = "<pre><code>\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 0);

    handleCodeBlockKeyDown(enter, editor);

    expect(editor.querySelector("pre")).toBeNull();
    expect(editor.querySelector("p")).not.toBeNull();
  });

  it("Shift+Enter no fim quebra a linha em vez de sair", () => {
    editor.innerHTML = "<pre><code>fim\n\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 4);

    handleCodeBlockKeyDown({ key: "Enter", shiftKey: true }, editor);

    expect(editor.querySelector("pre")).not.toBeNull();
    expect(codeText()).toBe("fim\n\n\n");
  });

  it("substitui a seleção pela quebra de linha", () => {
    editor.innerHTML = "<pre><code>abcd\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 1, 3);

    handleCodeBlockKeyDown(enter, editor);

    expect(codeText()).toBe("a\nd\n");
  });

  it("normaliza a estrutura que o navegador tenha criado dentro do bloco", () => {
    // Chromium insere <div>/<br> ao digitar em contentEditable.
    editor.innerHTML = "<pre><code>uma<div>duas</div></code></pre>";
    placeCaret(editor.querySelector("div")!.firstChild!, 4);

    handleCodeBlockKeyDown(enter, editor);

    expect(editor.querySelectorAll("pre code").length).toBe(1);
    expect(editor.querySelector("pre div")).toBeNull();
    expect(codeText()).toBe("uma\nduas\n\n");
  });
});

describe("insertTextInCodeBlock", () => {
  it("cola preservando as quebras de linha", () => {
    editor.innerHTML = "<pre><code>\n</code></pre>";
    placeCaret(editor.querySelector("code")!.firstChild!, 0);

    expect(insertTextInCodeBlock(editor, "a\r\nb\rc")).toBe(true);
    expect(codeText()).toBe("a\nb\nc\n");
    expect(editor.querySelector("pre br")).toBeNull();
  });

  it("recusa a colagem fora de um bloco de código", () => {
    editor.innerHTML = "<p>texto</p>";
    placeCaret(editor.querySelector("p")!.firstChild!, 0);

    expect(insertTextInCodeBlock(editor, "x")).toBe(false);
  });
});

describe("round-trip do arquivo", () => {
  it("mantém pre e code na sanitização", () => {
    editor.innerHTML = "<p>a</p>";
    placeCaret(editor.querySelector("p")!.firstChild!, 0, 1);
    toggleCodeBlock(editor);

    const sanitized = sanitizeNoteContent(editor.innerHTML);

    expect(sanitized).toContain("<pre><code>");
    expect(sanitizeNoteContent(sanitized)).toBe(sanitized);
  });
});
