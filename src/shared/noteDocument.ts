/**
 * Envelope do arquivo de nota: serializa/parseia uma `Note` para um
 * documento HTML **auto-contido** (um `.html` por nota).
 *
 * Estrutura do arquivo:
 *   <!doctype html>
 *   <html lang="pt-BR">
 *     <head>
 *       <meta charset="utf-8">
 *       <meta name="hz:id" content="...">                 metadados simples
 *       <meta name="hz:connection" content="id|motivo">   (repetido)
 *       <title>Título</title>
 *       <style>…</style>                                  render decente avulso
 *     </head>
 *     <body>
 *       <h1 class="hz-title">Título</h1>
 *       <article class="hz-prose">…corpo sanitizado…</article>
 *     </body>
 *   </html>
 *
 * As imagens ficam embutidas como data-URI base64 no próprio corpo (modelo
 * auto-contido). O SQLite é o índice derivado; este arquivo é a fonte da verdade.
 */

import {
  createNoteRecord,
  normalizeConnections,
  type Connection,
  type Note
} from "@/domain/notes";
import { sanitizeNoteContent } from "@/shared/html";

/** Prefixo dos metadados no `<meta name>`, para não colidir com meta padrão. */
const META_PREFIX = "hz:";

/** CSS mínimo embutido: um `.html` aberto avulso no navegador fica legível. */
const EMBEDDED_STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.5rem 6rem;
         font: 16px/1.6 system-ui, sans-serif; }
  .hz-title { font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 1rem; }
  .hz-prose h2, .hz-prose h3, .hz-prose h4, .hz-prose h5, .hz-prose h6 { line-height: 1.25; }
  .hz-prose img { max-width: 100%; height: auto; }
  .hz-prose figure { margin: 1rem 0; }
  .hz-prose figcaption { font-size: 0.85em; opacity: 0.7; }
  .hz-prose blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid currentColor; opacity: 0.85; }
  .hz-prose pre { overflow: auto; padding: 0.75rem; background: rgba(127,127,127,0.12); border-radius: 6px; }
  .hz-prose code { font-family: ui-monospace, monospace; }
  .hz-prose table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  .hz-prose th, .hz-prose td { border: 1px solid rgba(127,127,127,0.4); padding: 0.4rem 0.6rem; text-align: left; }
  .hz-prose hr { border: 0; border-top: 1px solid rgba(127,127,127,0.4); margin: 1.5rem 0; }
`.trim();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metaTag(name: string, content: string): string {
  return `    <meta name="${META_PREFIX}${name}" content="${escapeHtml(content)}">`;
}

/** Todos os `<meta name="hz:*">` da nota, incluindo uma linha por conexão. */
function renderMetaTags(note: Note): string {
  const connections = normalizeConnections(note.connections);
  return [
    metaTag("id", note.id),
    metaTag("folder", note.folder),
    metaTag("kind", note.kind),
    metaTag("template", note.template),
    metaTag("status", note.status),
    metaTag("createdAt", note.createdAt),
    metaTag("updatedAt", note.updatedAt),
    ...connections.map((connection) => metaTag("connection", `${connection.id}|${connection.reason}`))
  ].join("\n");
}

/** Monta o envelope do documento a partir das partes já preparadas/escapadas. */
function renderDocument(head: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${head}
    <title>${title}</title>
    <style>
${EMBEDDED_STYLE}
    </style>
  </head>
  <body>
    <h1 class="hz-title">${title}</h1>
    <article class="hz-prose">${body}</article>
  </body>
</html>
`;
}

/**
 * Serializa uma nota para o documento HTML auto-contido. O corpo passa pelo
 * sanitizer para manter o mesmo contrato de segurança do editor.
 *
 * @example serializeNoteToHtmlDocument(note) // "<!doctype html>…</html>\n"
 */
export function serializeNoteToHtmlDocument(note: Note): string {
  return renderDocument(
    renderMetaTags(note),
    escapeHtml(note.title),
    sanitizeNoteContent(note.content)
  );
}

/** Lê um `<meta name="hz:*">` do documento parseado. */
function readMeta(doc: Document, name: string): string {
  return (
    doc.head
      .querySelector(`meta[name="${META_PREFIX}${name}"]`)
      ?.getAttribute("content")
      ?.trim() ?? ""
  );
}

/** Título: preferimos o `<h1>` do corpo; caímos no `<title>` do `<head>`. */
function readTitle(doc: Document): string {
  return doc.body.querySelector(".hz-title")?.textContent?.trim() || doc.title?.trim() || "";
}

function readConnections(doc: Document): Connection[] {
  const raw = Array.from(
    doc.head.querySelectorAll(`meta[name="${META_PREFIX}connection"]`)
  ).map((element) => {
    const content = element.getAttribute("content") ?? "";
    const separator = content.indexOf("|");
    const id = separator === -1 ? content : content.slice(0, separator);
    const reason = separator === -1 ? "" : content.slice(separator + 1);
    return { id: id.trim(), reason };
  });
  // Reaproveita a normalização do domínio (dedup + limite de motivo).
  return normalizeConnections(raw);
}

/**
 * Parseia o documento HTML de volta para uma `Note`. Tolerante a arquivos
 * editados à mão: campos ausentes caem nos defaults de `createNoteRecord` e o
 * corpo é sempre re-sanitizado. Retorna `null` se não houver `hz:id`.
 *
 * @example parseHtmlDocumentToNote(html)?.title // "Minha Ideia"
 */
export function parseHtmlDocumentToNote(html: string): Note | null {
  if (typeof html !== "string" || !html.trim()) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const id = readMeta(doc, "id");
  if (!id) return null; // sem id não há como indexar/relacionar a nota

  const body = doc.body.querySelector(".hz-prose") ?? doc.body;
  return createNoteRecord({
    id,
    title: readTitle(doc),
    content: sanitizeNoteContent(body.innerHTML),
    folder: readMeta(doc, "folder"),
    kind: readMeta(doc, "kind"),
    template: readMeta(doc, "template"),
    status: readMeta(doc, "status"),
    connections: readConnections(doc),
    createdAt: readMeta(doc, "createdAt") || undefined,
    updatedAt: readMeta(doc, "updatedAt") || undefined
  });
}

/**
 * Nome de arquivo estável da nota: `<id>.html`. Usa o id (não o título) para o
 * nome não mudar quando o título é editado — renomear o título orfanaria o
 * arquivo antigo. O título legível vive dentro do documento (`<title>`/`<h1>`).
 *
 * @example noteFileName({ id: "abc" }) // "abc.html"
 */
export function noteFileName(note: Pick<Note, "id">): string {
  return `${note.id}.html`;
}
