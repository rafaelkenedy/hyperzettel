// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  CODE_LANGUAGES,
  PLAIN_LANGUAGE,
  highlightCodeBlock,
  highlightCodeBlocks,
  highlightToHtml,
  languageOf,
  setCodeLanguage
} from "./codeSyntax";
import { sanitizeNoteContent } from "@/shared/html";

let editor: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = "";
  editor = document.createElement("div");
  editor.contentEditable = "true";
  document.body.append(editor);
});

function addBlock(code: string, language?: string): HTMLPreElement {
  const pre = document.createElement("pre");
  if (language) pre.className = `language-${language}`;
  const element = document.createElement("code");
  element.textContent = code;
  pre.append(element);
  editor.append(pre);
  return pre;
}

/** Offset absoluto do caret dentro do bloco, como a pessoa o percebe. */
function caretOffset(pre: Element): number {
  const range = window.getSelection()!.getRangeAt(0);
  const measure = document.createRange();
  measure.setStart(pre, 0);
  measure.setEnd(range.startContainer, range.startOffset);
  return measure.toString().length;
}

function placeCaret(pre: Element, offset: number, endOffset = offset) {
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let startSet = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!startSet && seen + node.length >= offset) {
      range.setStart(node, offset - seen);
      startSet = true;
    }
    if (startSet && seen + node.length >= endOffset) {
      range.setEnd(node, endOffset - seen);
      break;
    }
    seen += node.length;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("highlightToHtml", () => {
  it("colore a linguagem escolhida", () => {
    const html = highlightToHtml("const a = 1;", "typescript");

    expect(html).toContain('<span class="hljs-keyword">const</span>');
  });

  it("não colore sem linguagem ou com uma desconhecida", () => {
    expect(highlightToHtml("const a = 1;", PLAIN_LANGUAGE)).toBeNull();
    expect(highlightToHtml("const a = 1;", "klingon")).toBeNull();
  });

  it("escapa o código que colore", () => {
    const html = highlightToHtml('const t = "<script>";', "typescript");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("colore código incompleto sem quebrar", () => {
    expect(highlightToHtml('const a = "aber', "typescript")).toContain("hljs-");
  });

  it("registra todas as linguagens oferecidas na barra", () => {
    CODE_LANGUAGES.filter((language) => language.id !== PLAIN_LANGUAGE).forEach((language) => {
      expect(highlightToHtml("a", language.id), language.id).not.toBeNull();
    });
  });
});

describe("languageOf e setCodeLanguage", () => {
  it("lê a linguagem declarada no pre", () => {
    expect(languageOf(addBlock("a", "rust"))).toBe("rust");
  });

  it("trata linguagem ausente ou desconhecida como sem cor", () => {
    expect(languageOf(addBlock("a"))).toBe(PLAIN_LANGUAGE);
    expect(languageOf(addBlock("a", "klingon"))).toBe(PLAIN_LANGUAGE);
  });

  it("troca a linguagem e recolore o bloco", () => {
    const pre = addBlock("const a = 1;\n");

    setCodeLanguage(pre, "typescript");

    expect(pre.className).toBe("language-typescript");
    expect(pre.querySelector(".hljs-keyword")?.textContent).toBe("const");
  });

  it("remove a cor e o atributo ao voltar para sem cor", () => {
    const pre = addBlock("const a = 1;\n", "typescript");
    highlightCodeBlock(pre);

    setCodeLanguage(pre, PLAIN_LANGUAGE);

    // `class=""` sujaria o arquivo da nota sem significar nada.
    expect(pre.hasAttribute("class")).toBe(false);
    expect(pre.querySelector("span")).toBeNull();
    expect(pre.textContent).toBe("const a = 1;\n");
  });
});

describe("highlightCodeBlock", () => {
  it("não altera o texto do bloco, só o markup", () => {
    const pre = addBlock("fn main() {}\n", "rust");

    expect(highlightCodeBlock(pre)).toBe(true);
    expect(pre.textContent).toBe("fn main() {}\n");
    expect(pre.querySelectorAll("span").length).toBeGreaterThan(0);
  });

  it("é idempotente: recolorir o mesmo conteúdo não mexe no DOM", () => {
    const pre = addBlock("fn main() {}\n", "rust");
    highlightCodeBlock(pre);

    expect(highlightCodeBlock(pre)).toBe(false);
  });

  it("mantém o caret na mesma posição do texto", () => {
    const pre = addBlock("const alpha = 1;\n", "typescript");
    placeCaret(pre, 11); // fim de "const alpha"

    highlightCodeBlock(pre);

    expect(caretOffset(pre)).toBe(11);
  });

  it("adia a recoloração enquanto há seleção dentro do bloco", () => {
    const pre = addBlock("const alpha = 1;\n", "typescript");
    placeCaret(pre, 0, 5);

    // Trocar o markup faria a seleção escapar da pessoa no meio do gesto.
    expect(highlightCodeBlock(pre)).toBe(false);
    expect(pre.querySelector("span")).toBeNull();
  });

  it("colore todos os blocos do corpo", () => {
    addBlock("const a = 1;\n", "typescript");
    addBlock("fn main() {}\n", "rust");
    addBlock("sem cor\n");

    expect(highlightCodeBlocks(editor)).toBe(true);
    expect(editor.querySelectorAll("pre .hljs-keyword").length).toBe(2);
  });
});

describe("round-trip do arquivo", () => {
  it("preserva a linguagem e os tokens na sanitização", () => {
    const pre = addBlock("const a = 1;\n", "typescript");
    highlightCodeBlock(pre);

    const sanitized = sanitizeNoteContent(editor.innerHTML);

    expect(sanitized).toContain('<pre class="language-typescript">');
    expect(sanitized).toContain('<span class="hljs-keyword">const</span>');
    expect(sanitizeNoteContent(sanitized)).toBe(sanitized);
  });

  it("descarta classes que não pertencem à coloração", () => {
    const sanitized = sanitizeNoteContent(
      '<pre class="language-rust evil"><code class="x"><span class="hljs-keyword y">fn</span></code></pre>'
    );

    expect(sanitized).toContain('<pre class="language-rust">');
    expect(sanitized).toContain("<code>");
    expect(sanitized).toContain('<span class="hljs-keyword">fn</span>');
  });
});
