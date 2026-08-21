/**
 * Coloração de sintaxe dos blocos de código.
 *
 * O token colorido é markup: `<span class="hljs-keyword">`. Por isso a
 * allowlist de `sanitizeNoteContent` passou a aceitar `class` em `PRE`, `CODE`
 * e `SPAN`, restrita aos nomes de token — nenhum outro atributo foi reaberto
 * (ADR 0006). A cor viaja com o arquivo: o `.html` avulso abre colorido.
 *
 * A linguagem fica em `class="language-…"` no `<pre>`, e não no `<code>`,
 * porque as operações de edição substituem os filhos do bloco: no `<pre>` a
 * escolha sobrevive a Enter, colagem e reindentação.
 *
 * Recolorir reescreve o DOM sob o caret. Aqui isso é seguro porque o conteúdo
 * de um bloco é só texto e `span`: a posição do caret é um offset de texto,
 * medido antes e reposto depois. Uma seleção em andamento cancela a operação
 * em vez de ser engolida por ela.
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

export interface CodeLanguage {
  id: string;
  label: string;
}

/** Sem linguagem: o bloco continua monoespaçado, apenas sem cor. */
export const PLAIN_LANGUAGE = "plaintext";

/**
 * Registro explícito, não o pacote inteiro do highlight.js: cada linguagem
 * custa bundle e a lista cobre o que aparece em notas de estudo.
 */
export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: PLAIN_LANGUAGE, label: "Sem cor" },
  { id: "bash", label: "Shell" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff" },
  { id: "go", label: "Go" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "sql", label: "SQL" },
  { id: "typescript", label: "TypeScript" },
  { id: "xml", label: "HTML / XML" },
  { id: "yaml", label: "YAML" }
];

const REGISTRATIONS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash, c, cpp, csharp, css, diff, go, java, javascript, json, markdown, python, rust,
  sql, typescript, xml, yaml
};

Object.entries(REGISTRATIONS).forEach(([id, definition]) => hljs.registerLanguage(id, definition));

const LANGUAGE_PREFIX = "language-";

/** Linguagem declarada no bloco; desconhecida ou ausente vira "sem cor". */
export function languageOf(pre: Element): string {
  const token = Array.from(pre.classList).find((name) => name.startsWith(LANGUAGE_PREFIX));
  const id = token ? token.slice(LANGUAGE_PREFIX.length) : PLAIN_LANGUAGE;
  return CODE_LANGUAGES.some((language) => language.id === id) ? id : PLAIN_LANGUAGE;
}

/** Marcação colorida de um trecho. Puro: mesma entrada, mesma saída. */
export function highlightToHtml(code: string, language: string): string | null {
  if (language === PLAIN_LANGUAGE || !hljs.getLanguage(language)) return null;
  // `ignoreIllegals`: código pela metade é o estado normal de quem digita.
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

/** Offset do caret dentro do bloco, ou `null` se ele não estiver lá. */
function caretOffsetIn(pre: Element): number | null {
  const selection = pre.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!pre.contains(range.startContainer)) return null;

  const measure = pre.ownerDocument.createRange();
  measure.setStart(pre, 0);
  measure.setEnd(range.startContainer, range.startOffset);
  return measure.toString().length;
}

/**
 * Há uma seleção em andamento tocando o bloco.
 *
 * Trocar o markup embaixo dela faria o trecho selecionado escapar da pessoa no
 * meio do gesto; adiar até a próxima pausa é mais barato que tentar remontá-la.
 */
function selectionTouches(pre: Element): boolean {
  const selection = pre.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (range.collapsed) return false;
  return pre.contains(range.startContainer) || pre.contains(range.endContainer);
}

function restoreCaret(pre: Element, offset: number): void {
  const doc = pre.ownerDocument;
  const walker = doc.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let target: Text | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (remaining <= node.length) {
      target = node;
      break;
    }
    remaining -= node.length;
  }
  if (!target) return;

  const range = doc.createRange();
  range.setStart(target, remaining);
  range.collapse(true);
  const selection = doc.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Recolore um bloco. Devolve `true` quando o markup mudou — o chamador então
 * precisa reserializar a nota.
 */
export function highlightCodeBlock(pre: HTMLElement): boolean {
  if (selectionTouches(pre)) return false;

  const doc = pre.ownerDocument;
  const text = pre.textContent ?? "";
  const markup = highlightToHtml(text, languageOf(pre));

  const next = doc.createElement("code");
  if (markup === null) next.textContent = text;
  else next.innerHTML = markup;

  const current = pre.firstElementChild;
  const unchanged =
    pre.childNodes.length === 1 &&
    current?.tagName === "CODE" &&
    current.innerHTML === next.innerHTML;
  if (unchanged) return false;

  const caret = caretOffsetIn(pre);
  pre.replaceChildren(next);
  if (caret !== null) restoreCaret(pre, caret);
  return true;
}

/** Recolore todos os blocos do corpo. Devolve `true` se algum mudou. */
export function highlightCodeBlocks(editor: HTMLElement): boolean {
  return Array.from(editor.querySelectorAll("pre")).reduce(
    (changed, pre) => highlightCodeBlock(pre) || changed,
    false
  );
}

/** Troca a linguagem do bloco e recolore imediatamente. */
export function setCodeLanguage(pre: HTMLElement, id: string): void {
  Array.from(pre.classList)
    .filter((name) => name.startsWith(LANGUAGE_PREFIX))
    .forEach((name) => pre.classList.remove(name));

  if (id !== PLAIN_LANGUAGE) pre.classList.add(`${LANGUAGE_PREFIX}${id}`);
  // `class=""` sujaria o arquivo da nota sem significar nada.
  if (!pre.getAttribute("class")) pre.removeAttribute("class");

  highlightCodeBlock(pre);
}
