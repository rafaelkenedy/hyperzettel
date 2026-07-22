/**
 * Sanitização e formatação do HTML das notas.
 * Porte de `scripts/shared/html.js`: allowlist de elementos e atributos,
 * links restritos a esquemas seguros e imagens sem `src` persistido.
 */

const ALLOWED_NOTE_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DIV", "EM", "FIGCAPTION", "FIGURE",
  "H1", "H2", "H3", "I", "IMG", "LI", "OL", "P", "PRE", "S", "SPAN", "STRONG", "U", "UL"
]);

const REMOVED_NOTE_TAGS = new Set([
  "EMBED", "IFRAME", "LINK", "META", "OBJECT", "SCRIPT", "STYLE"
]);

export function sanitizeNoteContent(value: unknown): string {
  const template = document.createElement("template");
  template.innerHTML = typeof value === "string" ? value : "";

  Array.from(template.content.querySelectorAll("*")).forEach((element) => {
    if (REMOVED_NOTE_TAGS.has(element.tagName)) {
      element.remove();
      return;
    }
    if (!ALLOWED_NOTE_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    const allowedAttributes =
      element.tagName === "A"
        ? new Set(["href", "target", "title"])
        : element.tagName === "IMG"
          ? new Set(["alt", "data-image-id"])
          : new Set<string>();

    Array.from(element.attributes).forEach((attribute) => {
      if (!allowedAttributes.has(attribute.name)) element.removeAttribute(attribute.name);
    });

    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (!/^(?:https?:|mailto:|tel:|#)/i.test(href)) element.removeAttribute("href");
      if (element.getAttribute("target") === "_blank") {
        element.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (element.tagName === "IMG") {
      element.removeAttribute("src");
      if (!(element as HTMLElement).dataset.imageId) element.remove();
    }
  });

  return template.innerHTML.trim();
}

export function toPlainText(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html || "";
  container
    .querySelectorAll("br, p, div, h1, h2, h3, li, blockquote, pre, figcaption")
    .forEach((element) => element.append(" "));
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface NoteSection {
  title: string;
  html: string;
}

/**
 * Divide o conteúdo pelas seções de nível H2.
 *
 * Serve à pergunta "existe mais de uma ideia?" do fluxo de processamento:
 * uma nota que acumulou vários títulos quase sempre está defendendo mais de
 * uma ideia, e cada uma precisa poder se conectar de forma independente.
 *
 * O texto antes do primeiro H2 é preservado como preâmbulo e não vira seção,
 * porque costuma ser contexto da nota inteira, não uma ideia própria.
 */
export function splitByHeadings(html: string): NoteSection[] {
  const container = document.createElement("div");
  container.innerHTML = html || "";

  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;

  Array.from(container.childNodes).forEach((node) => {
    const isHeading =
      node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "H2";

    if (isHeading) {
      if (current) sections.push(current);
      current = { title: (node.textContent ?? "").trim() || "Sem título", html: "" };
      return;
    }
    if (!current) return;

    const fragment = document.createElement("div");
    fragment.append(node.cloneNode(true));
    current.html += fragment.innerHTML;
  });

  if (current) sections.push(current);

  // Seções sem corpo não carregam ideia alguma.
  return sections.filter((section) => toPlainText(section.html).length > 0);
}

export function countWords(html: string): number {
  const text = toPlainText(html);
  if (!text) return 0;
  return text.split(/\s+/).length;
}

/** Tamanho aproximado da nota serializada, no formato usado pelo painel de info. */
export function formatSize(html: string): string {
  const bytes = new TextEncoder().encode(html || "").length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const fullDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric"
});

export function formatDate(value?: string): string {
  if (!value) return "Agora";
  return dayMonth.format(new Date(value));
}

export function formatFullDate(value?: string): string {
  if (!value) return "—";
  return fullDate.format(new Date(value));
}

/** "há 2 h", "agora", "3 d" — usado na lista de notas, como no print. */
export function formatRelative(value?: string): string {
  if (!value) return "agora";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "agora";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "agora";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min atrás`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h atrás`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d atrás`;

  return formatDate(value);
}
