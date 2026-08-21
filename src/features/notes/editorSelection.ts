/**
 * Leitura da seleção dentro do corpo da nota.
 *
 * O editor é um `contentEditable` não controlado pelo React: qualquer ação de
 * formatação precisa partir da seleção real do documento, e só vale quando ela
 * pertence ao corpo da nota — nunca ao título ou a outro painel.
 */

/** Seleção atual, apenas quando ela pertence ao corpo da nota. */
export function activeRange(editor: HTMLElement): Range | null {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}

/** Ancestral com essa tag entre `node` e o editor, sem sair do corpo da nota. */
export function closestWithin(
  node: Node | null,
  editor: HTMLElement,
  tagName: string
): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== editor) {
    if (current.nodeType === Node.ELEMENT_NODE && (current as Element).tagName === tagName) {
      return current as HTMLElement;
    }
    current = current.parentNode;
  }
  return null;
}

/** Aplica um Range como seleção do documento. */
export function applySelection(range: Range): void {
  const selection = range.startContainer.ownerDocument?.defaultView?.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
