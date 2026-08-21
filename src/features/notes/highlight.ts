/**
 * Destaque (marca-texto) do editor.
 *
 * `execCommand("hiliteColor")` produz `<span style="background-color:…">` e o
 * sanitizador remove todo atributo `style` — o destaque não sobreviveria ao
 * arquivo da nota. `<mark>` carrega o mesmo significado sem atributo algum,
 * então persiste no HTML, continua legível ao abrir o arquivo fora do
 * aplicativo e não amplia a superfície de XSS.
 *
 * Uma seleção que atravessa parágrafos vira uma marca por bloco: `<mark>` é
 * inline e envolver blocos inteiros produziria HTML inválido.
 */

import { activeRange, applySelection, closestWithin } from "./editorSelection";

const HIGHLIGHT_TAG = "MARK";

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/** Há sobreposição real — encostar na borda não conta. */
function overlaps(range: Range, node: Node): boolean {
  const nodeRange = node.ownerDocument!.createRange();
  nodeRange.selectNodeContents(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
  );
}

/**
 * Quebra os nós de texto nas bordas da seleção para que cada nó fique
 * inteiramente dentro ou inteiramente fora dela.
 *
 * O fim é dividido antes do início: o contrário deslocaria um fim que ainda
 * não foi tratado quando as duas bordas estão no mesmo nó.
 */
function splitBoundaries(range: Range): void {
  const { startContainer, startOffset, endContainer, endOffset } = range;

  if (isText(endContainer) && endOffset > 0 && endOffset < endContainer.length) {
    endContainer.splitText(endOffset);
  }
  if (isText(startContainer) && startOffset > 0 && startOffset < startContainer.length) {
    const rest = startContainer.splitText(startOffset);
    if (startContainer === endContainer) range.setEnd(rest, endOffset - startOffset);
    range.setStart(rest, 0);
  }
}

function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (isText(root)) return [root];

  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.length && overlaps(range, node)) nodes.push(node);
  }
  return nodes;
}

/** Marcas que a seleção cobre, incluindo aquela onde o caret está parado. */
function marksInRange(range: Range, editor: HTMLElement): HTMLElement[] {
  const inside = closestWithin(range.commonAncestorContainer, editor, HIGHLIGHT_TAG);
  if (range.collapsed) return inside ? [inside] : [];

  const marks = Array.from(editor.querySelectorAll("mark")).filter((mark) =>
    overlaps(range, mark)
  );
  return inside && !marks.includes(inside) ? [inside, ...marks] : marks;
}

/** Desfaz as marcas por inteiro: destaque pela metade confunde mais que ajuda. */
function removeHighlight(marks: HTMLElement[]): void {
  const moved = marks.flatMap((mark) => Array.from(mark.childNodes));
  marks.forEach((mark) => mark.replaceWith(...Array.from(mark.childNodes)));
  if (!moved.length) return;

  const range = moved[0].ownerDocument!.createRange();
  range.setStartBefore(moved[0]);
  range.setEndAfter(moved[moved.length - 1]);
  applySelection(range);
}

function applyHighlight(editor: HTMLElement, range: Range): void {
  splitBoundaries(range);

  const nodes = textNodesIn(range).filter(
    (node) =>
      node.data.trim().length > 0 &&
      // Um bloco de código é achatado em texto puro a cada operação: a marca
      // seria perdida sem aviso.
      !closestWithin(node, editor, "PRE") &&
      !closestWithin(node, editor, HIGHLIGHT_TAG)
  );
  if (!nodes.length) return;

  nodes.forEach((node) => {
    const mark = node.ownerDocument.createElement("mark");
    node.replaceWith(mark);
    mark.append(node);
  });

  const next = nodes[0].ownerDocument.createRange();
  next.setStartBefore(nodes[0]);
  next.setEndAfter(nodes[nodes.length - 1]);
  applySelection(next);
}

/** O caret está dentro de um destaque, ou a seleção cobre algum. */
export function isHighlightActive(editor: HTMLElement): boolean {
  const range = activeRange(editor);
  return range ? marksInRange(range, editor).length > 0 : false;
}

/**
 * Destaca a seleção, ou remove o destaque que ela já cobre. É a ação da barra
 * de formatação.
 *
 * Sem seleção não há o que destacar; com o caret parado dentro de uma marca, a
 * ação remove aquela marca.
 */
export function toggleHighlight(editor: HTMLElement): void {
  const range = activeRange(editor);
  if (!range) return;

  const marks = marksInRange(range, editor);
  if (marks.length) {
    removeHighlight(marks);
    return;
  }
  if (range.collapsed) return;

  applyHighlight(editor, range);
}
