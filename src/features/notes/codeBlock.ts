/**
 * Bloco de código do editor.
 *
 * Não passa por `document.execCommand`: `formatBlock` não produz
 * `<pre><code>` e nenhum navegador trata Enter ou colagem dentro de um `<pre>`
 * de forma previsível. Toda a manipulação usa Range/Selection, o que também
 * deixa a regra testável em jsdom.
 *
 * **Invariante do sentinela:** o texto do bloco termina sempre com um `\n` que
 * não pertence ao conteúdo. Sem ele o navegador não desenha a última linha
 * vazia e a pessoa digitaria às cegas depois de pressionar Enter no fim do
 * bloco. É esse caractere que distingue "linha vazia no fim" de "fim do
 * bloco" — e é o que permite sair do bloco com um segundo Enter.
 *
 * `PRE` e `CODE` já pertencem à allowlist de `sanitizeNoteContent`, então o
 * round-trip com o arquivo HTML não precisa de nada novo.
 */

import { activeRange, closestWithin } from "./editorSelection";

/** Elementos que fecham linha quando um bloco é achatado em texto puro. */
const BLOCK_TAGS = new Set([
  "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "PRE", "TR"
]);

/** Marcador temporário do caret; nunca sobrevive a uma operação. */
const CARET_MARK = "\u0000";

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName);
}

/** Concatena os filhos abrindo uma linha antes de cada bloco. */
function textFromChildren(node: Node): string {
  return Array.from(node.childNodes).reduce((text, child) => {
    const separator = isBlock(child) && text && !text.endsWith("\n") ? "\n" : "";
    return text + separator + textFrom(child);
  }, "");
}

/**
 * Texto puro de um nó, com quebras onde o HTML quebra a linha.
 *
 * O `contentEditable` insere `&nbsp;` ao digitar espaços consecutivos, porque
 * em texto comum o HTML colapsaria a sequência. Dentro de um `<pre>` isso não
 * é necessário — o espaço já é preservado — e é ativamente nocivo: copiar o
 * código para um compilador levaria U+00A0 junto, que não é espaço em branco
 * válido em praticamente nenhuma linguagem.
 */
function textFrom(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").replace(/\u00a0/g, " ");
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return textFromChildren(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  if (element.tagName === "BR") return "\n";

  const text = textFromChildren(element);
  return BLOCK_TAGS.has(element.tagName) && !text.endsWith("\n") ? `${text}\n` : text;
}

function ensureSentinel(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function emptyParagraph(doc: Document): HTMLParagraphElement {
  const paragraph = doc.createElement("p");
  paragraph.append(doc.createElement("br"));
  return paragraph;
}

/** O `<pre>` que contém `node`, se houver um dentro do editor. */
export function findCodeBlock(node: Node | null, editor: HTMLElement): HTMLPreElement | null {
  return closestWithin(node, editor, "PRE") as HTMLPreElement | null;
}

/** O bloco de código onde o caret está agora, se estiver em um. */
export function activeCodeBlock(editor: HTMLElement): HTMLPreElement | null {
  const range = activeRange(editor);
  return range ? findCodeBlock(range.commonAncestorContainer, editor) : null;
}

/** Bloco de primeiro nível do corpo que contém `node`. */
function topLevelBlock(node: Node, editor: HTMLElement): ChildNode | null {
  let current: Node | null = node;
  while (current && current.parentNode && current.parentNode !== editor) {
    current = current.parentNode;
  }
  return current && current.parentNode === editor ? (current as ChildNode) : null;
}

function isEmptyBlock(node: ChildNode): boolean {
  if (node.textContent?.trim()) return false;
  return !(node.nodeType === Node.ELEMENT_NODE && (node as Element).querySelector("img, figure"));
}

function insertMarker(doc: Document, container: Node, offset: number): void {
  const range = doc.createRange();
  range.setStart(container, offset);
  range.collapse(true);
  range.insertNode(doc.createTextNode(CARET_MARK));
}

interface CodeSelection {
  /** Único nó de texto do bloco depois do achatamento. */
  text: Text;
  start: number;
  end: number;
}

/**
 * Achata o bloco em `<code>` com um único nó de texto e devolve a seleção
 * convertida em offsets desse texto.
 *
 * O caret é preservado por marcadores inseridos no DOM antes da leitura: é a
 * única forma exata de mapear uma posição que pode estar em qualquer `<div>`
 * ou `<br>` que o navegador tenha criado dentro do `<pre>`.
 */
function readSelection(pre: HTMLPreElement, range: Range | null): CodeSelection {
  const doc = pre.ownerDocument;

  if (range) {
    // O marcador final entra primeiro: inserir o inicial antes deslocaria o
    // ponto final ainda não marcado.
    if (!range.collapsed) insertMarker(doc, range.endContainer, range.endOffset);
    insertMarker(doc, range.startContainer, range.startOffset);
  }

  let text = textFrom(pre);
  let start = text.indexOf(CARET_MARK);
  let end = start;

  if (start >= 0) {
    text = text.slice(0, start) + text.slice(start + 1);
    const second = text.indexOf(CARET_MARK);
    if (second >= 0) {
      text = text.slice(0, second) + text.slice(second + 1);
      end = second;
    }
  }

  text = ensureSentinel(text);
  const usableEnd = text.length - 1;
  if (start < 0) start = usableEnd;
  if (end < start) end = start;
  start = Math.min(start, usableEnd);
  end = Math.min(end, usableEnd);

  const node = doc.createTextNode(text);
  const code = doc.createElement("code");
  code.append(node);
  pre.replaceChildren(code);

  return { text: node, start, end };
}

function selectRange(node: Node, start: number, end: number): void {
  const doc = node.ownerDocument;
  const selection = doc?.defaultView?.getSelection();
  if (!doc || !selection) return;

  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Substitui o trecho selecionado dentro do bloco e recoloca o caret. */
function replaceText(selection: CodeSelection, insert: string): void {
  const value = selection.text.data;
  const next = value.slice(0, selection.start) + insert + value.slice(selection.end);
  selection.text.data = ensureSentinel(next);
  const caret = selection.start + insert.length;
  selectRange(selection.text, caret, caret);
}

function insertCodeBlock(editor: HTMLElement, range: Range | null): void {
  const doc = editor.ownerDocument;
  const selected = range && !range.collapsed ? textFrom(range.cloneContents()) : "";

  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  const text = doc.createTextNode(ensureSentinel(selected));
  code.append(text);
  pre.append(code);

  const anchor = range ? topLevelBlock(range.startContainer, editor) : null;
  if (range && !range.collapsed) range.deleteContents();

  if (!anchor) editor.append(pre);
  else if (isEmptyBlock(anchor)) anchor.replaceWith(pre);
  else anchor.after(pre);

  // Sem um bloco depois do `<pre>` não há para onde clicar para continuar
  // escrevendo, e o Enter de saída seria o único caminho.
  if (!pre.nextSibling) pre.after(emptyParagraph(doc));

  const caret = text.data.length - 1;
  selectRange(text, caret, caret);
}

/** Converte o bloco de volta em parágrafos, uma linha por parágrafo. */
function unwrapCodeBlock(pre: HTMLPreElement, editor: HTMLElement): void {
  const doc = pre.ownerDocument;
  const selection = readSelection(pre, activeRange(editor));
  const lines = selection.text.data.replace(/\n$/, "").split("\n");

  const paragraphs = lines.map((line) => {
    if (!line) return emptyParagraph(doc);
    const paragraph = doc.createElement("p");
    paragraph.textContent = line;
    return paragraph;
  });
  if (!paragraphs.length) paragraphs.push(emptyParagraph(doc));

  const fragment = doc.createDocumentFragment();
  fragment.append(...paragraphs);
  pre.replaceWith(fragment);

  selectRange(paragraphs[0], 0, 0);
}

/**
 * Cria um bloco de código a partir da seleção, ou desfaz o bloco onde o caret
 * já está. É a ação da barra de formatação.
 */
export function toggleCodeBlock(editor: HTMLElement): void {
  const range = activeRange(editor);
  const pre = range ? findCodeBlock(range.commonAncestorContainer, editor) : null;
  if (pre) {
    unwrapCodeBlock(pre, editor);
    return;
  }
  insertCodeBlock(editor, range);
}

/**
 * Enter dentro de um bloco quebra a linha em vez de sair dele. Um segundo
 * Enter na última linha vazia fecha o bloco e devolve o caret a um parágrafo
 * comum — sem isso não haveria saída pelo teclado.
 *
 * Devolve `true` quando tratou o evento; o chamador deve cancelar o padrão.
 */
export function handleCodeBlockKeyDown(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  editor: HTMLElement
): boolean {
  if (event.key !== "Enter") return false;

  const range = activeRange(editor);
  const pre = range ? findCodeBlock(range.commonAncestorContainer, editor) : null;
  if (!pre || !range) return false;

  const selection = readSelection(pre, range);
  const value = selection.text.data;
  const usableEnd = value.length - 1;

  const collapsedAtEnd = selection.start === selection.end && selection.start >= usableEnd;
  const onEmptyLastLine = usableEnd === 0 || value[usableEnd - 1] === "\n";

  if (!event.shiftKey && collapsedAtEnd && onEmptyLastLine) {
    exitCodeBlock(pre, selection, usableEnd);
    return true;
  }

  replaceText(selection, "\n");
  return true;
}

function exitCodeBlock(pre: HTMLPreElement, selection: CodeSelection, usableEnd: number): void {
  const doc = pre.ownerDocument;
  const paragraph = emptyParagraph(doc);
  const content = usableEnd === 0 ? "" : selection.text.data.slice(0, usableEnd - 1);

  if (!content) {
    pre.replaceWith(paragraph);
  } else {
    selection.text.data = ensureSentinel(content);
    pre.after(paragraph);
  }

  selectRange(paragraph, 0, 0);
}

/**
 * Cola texto puro dentro do bloco preservando as quebras de linha.
 * `execCommand("insertText")` inseriria `<div>`s no meio do `<pre>`.
 *
 * Devolve `false` quando o caret não está em um bloco de código.
 */
export function insertTextInCodeBlock(editor: HTMLElement, value: string): boolean {
  const range = activeRange(editor);
  const pre = range ? findCodeBlock(range.commonAncestorContainer, editor) : null;
  if (!pre || !range) return false;

  replaceText(readSelection(pre, range), value.replace(/\r\n?/g, "\n"));
  return true;
}
