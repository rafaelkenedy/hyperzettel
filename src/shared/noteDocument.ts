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
 *       <aside class="hz-connections">…conexões legíveis…</aside>
 *     </body>
 *   </html>
 *
 * As imagens ficam embutidas como data-URI base64 no próprio corpo (modelo
 * auto-contido). O SQLite é o índice derivado; este arquivo é a fonte da verdade.
 */

import {
  createId,
  createNoteRecord,
  normalizeConnections,
  type Connection,
  type Note,
  type RelationDirection
} from "@/domain/notes";
import { sanitizeNoteContent } from "@/shared/html";
import { slugify } from "@/shared/slug";

/** Prefixo dos metadados no `<meta name>`, para não colidir com meta padrão. */
const META_PREFIX = "hz:";

/**
 * CSS mínimo embutido: um `.html` aberto avulso no navegador fica legível.
 *
 * O estilo é montado por blocos, e cada bloco só entra quando o documento usa
 * aquilo. Não é economia de disco — 3 KB por nota não pesam perto de uma
 * imagem base64 — é para conter o churn: com o estilo inteiro em todo arquivo,
 * mexer na paleta de código reescrevia até a nota que nunca teve código, e o
 * vault inteiro aparecia modificado no git e no sincronizador.
 *
 * Espelha as regras de `.hz-prose` em `src/index.css`; mantenha as duas em
 * sincronia.
 */
interface StyleBlock {
  /** `true` quando o documento precisa deste bloco. */
  applies: (document: { body: string; connections: string }) => boolean;
  css: string;
}

const ALWAYS = () => true;

const STYLE_BLOCKS: StyleBlock[] = [
  {
    applies: ALWAYS,
    css: `  :root { color-scheme: light dark; }
  body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.5rem 6rem;
         font: 16px/1.6 system-ui, sans-serif; }
  .hz-title { font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 1rem; }
  .hz-prose h2, .hz-prose h3, .hz-prose h4, .hz-prose h5, .hz-prose h6 { line-height: 1.25; }`
  },
  {
    applies: ({ body }) => body.includes("<img") || body.includes("<figure"),
    css: `  .hz-prose img { max-width: 100%; height: auto; }
  .hz-prose figure { margin: 1rem 0; }
  .hz-prose figcaption { font-size: 0.85em; opacity: 0.7; }`
  },
  {
    applies: ({ body }) => body.includes("<mark"),
    css: `  .hz-prose mark { background: rgba(250, 204, 21, 0.38); color: inherit;
                   padding: 0 0.15em; border-radius: 3px; }`
  },
  {
    applies: ({ body }) => body.includes("<blockquote"),
    css: `  .hz-prose blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid currentColor; opacity: 0.85; }`
  },
  {
    applies: ({ body }) => body.includes("<code"),
    css: `  .hz-prose code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }`
  },
  {
    applies: ({ body }) => body.includes("<pre"),
    css: `  .hz-prose pre { overflow: auto; margin: 1.25rem 0; padding: 0.9rem 1rem; border-radius: 8px;
                  background: #1f1e1b; color: #eceae5;
                  font: 0.85em/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .hz-prose pre code { display: block; background: none; padding: 0; font-size: 1em; color: inherit; }`
  },
  {
    // Um bloco sem linguagem não tem token colorido: a paleta inteira sobra.
    applies: ({ body }) => body.includes('class="hljs'),
    css: `  .hz-prose .hljs-comment, .hz-prose .hljs-quote { color: #8d8478; font-style: italic; }
  .hz-prose .hljs-keyword, .hz-prose .hljs-selector-tag, .hz-prose .hljs-literal,
  .hz-prose .hljs-section { color: #e0836c; }
  .hz-prose .hljs-string, .hz-prose .hljs-regexp, .hz-prose .hljs-addition,
  .hz-prose .hljs-meta .hljs-string { color: #9fc98a; }
  .hz-prose .hljs-number, .hz-prose .hljs-symbol, .hz-prose .hljs-bullet,
  .hz-prose .hljs-template-variable { color: #d7b06a; }
  .hz-prose .hljs-title, .hz-prose .hljs-name, .hz-prose .hljs-selector-id,
  .hz-prose .hljs-selector-class { color: #86b3e0; }
  .hz-prose .hljs-type, .hz-prose .hljs-built_in, .hz-prose .hljs-class .hljs-title { color: #6fc7c0; }
  .hz-prose .hljs-attr, .hz-prose .hljs-attribute, .hz-prose .hljs-variable,
  .hz-prose .hljs-property, .hz-prose .hljs-params { color: #c8a6e8; }
  .hz-prose .hljs-meta, .hz-prose .hljs-deletion { color: #a9a29a; }
  .hz-prose .hljs-emphasis { font-style: italic; }
  .hz-prose .hljs-strong { font-weight: 600; }`
  },
  {
    applies: ({ body }) => body.includes("<table"),
    css: `  .hz-prose table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  .hz-prose th, .hz-prose td { border: 1px solid rgba(127,127,127,0.4); padding: 0.4rem 0.6rem; text-align: left; }`
  },
  {
    applies: ({ body }) => body.includes("<hr"),
    css: `  .hz-prose hr { border: 0; border-top: 1px solid rgba(127,127,127,0.4); margin: 1.5rem 0; }`
  },
  {
    applies: ({ connections }) => connections.length > 0,
    css: `  .hz-connections { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid rgba(127,127,127,0.4); }
  .hz-connections h2 { margin: 0 0 1rem; font-size: 1rem; }
  .hz-connections h3 { margin: 1.25rem 0 0.4rem; font-size: 0.75rem; font-weight: 600;
                       text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.62; }
  .hz-connections h3:first-of-type { margin-top: 0; }
  .hz-connections ul { margin: 0; padding-left: 1.25rem; }
  .hz-connections li { margin-top: 0.35rem; }
  .hz-connection-reason { margin: 0.15rem 0 0; font-size: 0.9em; opacity: 0.8; }`
  },
  {
    // Só aparece quando a relação não tem arquivo conhecido para virar âncora.
    applies: ({ connections }) => connections.includes("hz-connection-id"),
    css: `  .hz-connection-id { font: 0.75rem/1.4 ui-monospace, monospace; opacity: 0.55;
                      overflow-wrap: anywhere; }`
  }
];

function buildStyle(body: string, connections: string): string {
  return STYLE_BLOCKS.filter((block) => block.applies({ body, connections }))
    .map((block) => block.css)
    .join("\n");
}

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

/**
 * Contêineres cujos filhos ganham uma linha própria no arquivo.
 *
 * Quebrar *entre* blocos é seguro: espaço em branco ali não é renderizado.
 * Quebrar *dentro* de conteúdo inline não é — um `\n` no meio de
 * `<p>um <em>trecho</em></p>` vira um espaço de verdade. Por isso a lista é
 * fechada, e `PRE` jamais entra nela: lá o espaço é o conteúdo.
 */
const BREAK_INSIDE = new Set([
  "UL", "OL", "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "FIGURE"
]);

function isBreakContainer(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BREAK_INSIDE.has((node as Element).tagName);
}

/** `<p …>` a partir do elemento, sem os filhos. `null` para tags vazias. */
function openTagOf(element: Element): string | null {
  const shallow = element.cloneNode(false) as Element;
  const html = shallow.outerHTML;
  const closing = `</${element.tagName.toLowerCase()}>`;
  return html.endsWith(closing) ? html.slice(0, -closing.length) : null;
}

function formatNode(node: ChildNode, indent: string): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    // Espaço entre blocos é formatação de arquivo, não conteúdo.
    return text.trim() ? `${indent}${escapeHtml(text.trim())}` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  const open = isBreakContainer(element) ? openTagOf(element) : null;
  if (open === null) return `${indent}${element.outerHTML}`;

  const children = Array.from(element.childNodes)
    .map((child) => formatNode(child, `${indent}  `))
    .filter(Boolean);
  if (!children.length) return `${indent}${element.outerHTML}`;

  const close = `</${element.tagName.toLowerCase()}>`;
  return `${indent}${open}\n${children.join("\n")}\n${indent}${close}`;
}

/**
 * Indenta o corpo com um bloco por linha.
 *
 * Um parágrafo editado passa a ser uma linha alterada no diff, em vez de
 * repintar o corpo inteiro. A operação é idempotente: reformatar um corpo já
 * formatado devolve exatamente o mesmo texto, porque o espaço introduzido aqui
 * é descartado na próxima leitura.
 */
export function formatNoteBody(html: string, indent = "      "): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  return Array.from(template.content.childNodes)
    .map((node) => formatNode(node, indent))
    .filter(Boolean)
    .join("\n");
}

/**
 * Desfaz a indentação do arquivo: o conteúdo em memória é o mesmo que o
 * `contentEditable` produz, sem os nós de espaço introduzidos na gravação.
 * Sem isso, abrir uma nota já a marcaria como suja e dispararia autosave.
 */
export function unformatNoteBody(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const drop = (parent: ParentNode) => {
    Array.from(parent.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE && !(child.nodeValue ?? "").trim()) {
        child.remove();
        return;
      }
      if (isBreakContainer(child)) drop(child as Element);
    });
  };
  drop(template.content);

  return template.innerHTML.trim();
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
    ...(note.recallPrompt ? [metaTag("recallPrompt", note.recallPrompt)] : []),
    metaTag("createdAt", note.createdAt),
    metaTag("updatedAt", note.updatedAt),
    ...connections.map((connection) => metaTag("connection", `${connection.id}|${connection.reason}`))
  ].join("\n");
}

/**
 * Uma nota relacionada, do ponto de vista da nota sendo serializada.
 *
 * Vem de fora porque metade dessa informação não está neste arquivo: o
 * backlink é a conexão que *outra* nota declarou. O nome físico permite a
 * âncora e é conhecido só na fronteira do vault.
 */
export interface RelatedNoteView {
  id: string;
  title: string;
  /** Vazio quando o arquivo é desconhecido: aí o item vira texto sem link. */
  fileName: string;
  direction: RelationDirection;
  /** Motivo declarado por esta nota. */
  reason: string;
  /** Motivo declarado pela outra ponta sobre esta nota. */
  incomingReason: string;
}

/**
 * A direção é um cabeçalho de grupo, não um rótulo por item: repeti-la em
 * cada linha vira ruído numa nota de estrutura, que cita dezenas.
 */
const DIRECTION_LABEL: Record<RelationDirection, string> = {
  mutual: "Conexão mútua",
  outgoing: "Esta nota cita",
  incoming: "Citada por"
};

/** Ordem dos grupos: primeiro o que as duas notas afirmam. */
const DIRECTION_ORDER: RelationDirection[] = ["mutual", "outgoing", "incoming"];

/**
 * Motivos visíveis do item. Só a relação mútua precisa dizer de quem é cada
 * motivo; nos outros grupos o cabeçalho já responde isso.
 */
function relationReasons(relation: RelatedNoteView): string[] {
  if (relation.direction === "mutual") {
    return [
      relation.reason ? `Motivo desta nota: ${relation.reason}` : "",
      relation.incomingReason ? `Motivo da outra nota: ${relation.incomingReason}` : ""
    ].filter(Boolean);
  }
  const reason = relation.direction === "incoming" ? relation.incomingReason : relation.reason;
  return reason ? [reason] : [];
}

function renderRelationItem(relation: RelatedNoteView): string {
  const label = escapeHtml(relation.title || "Sem título");
  // O id fica no `title` da âncora: continua recuperável quando o link
  // quebra, sem ocupar uma linha própria em cada item.
  const target = relation.fileName
    ? `<a href="${escapeHtml(encodeURI(relation.fileName))}" title="${escapeHtml(relation.id)}">${label}</a>`
    : `${label} <span class="hz-connection-id">${escapeHtml(relation.id)}</span>`;

  const reasons = relationReasons(relation)
    .map((reason) => `\n        <p class="hz-connection-reason">${escapeHtml(reason)}</p>`)
    .join("");

  return `        <li>${target}${reasons}</li>`;
}

function renderRelationGroup(
  direction: RelationDirection,
  relations: RelatedNoteView[]
): string {
  if (!relations.length) return "";
  return `
      <h3>${DIRECTION_LABEL[direction]}</h3>
      <ul>
${relations.map(renderRelationItem).join("\n")}
      </ul>`;
}

/**
 * Projeção humana das relações — as que esta nota declarou **e** as que outras
 * notas declararam sobre ela. Fica fora de `.hz-prose`, portanto nunca volta
 * como corpo da nota; os metas `hz:connection` do head continuam sendo a fonte
 * canônica, e continuam registrando apenas a saída.
 *
 * Sem contexto (`related` ausente) o arquivo mostra só o que ele próprio sabe:
 * os destinos declarados, sem título nem backlink. Com contexto, uma lista
 * vazia significa "esta nota não tem relação viva" — inclusive quando o
 * `hz:connection` aponta para uma nota já excluída. O meta continua sendo a
 * declaração da pessoa; a seção visível mostra o que existe.
 */
function renderVisibleConnections(note: Note, related?: RelatedNoteView[]): string {
  const relations =
    related ??
    normalizeConnections(note.connections).map((connection) => ({
      id: connection.id,
      title: connection.id,
      fileName: "",
      direction: "outgoing" as RelationDirection,
      reason: connection.reason,
      incomingReason: ""
    }));
  if (!relations.length) return "";

  const groups = DIRECTION_ORDER.map((direction) =>
    renderRelationGroup(
      direction,
      relations.filter((relation) => relation.direction === direction)
    )
  ).join("");

  return `
    <aside class="hz-connections" aria-labelledby="hz-connections-title">
      <h2 id="hz-connections-title">Conexões</h2>${groups}
    </aside>`;
}

/** Monta o envelope do documento a partir das partes já preparadas/escapadas. */
function renderDocument(head: string, title: string, body: string, connections: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${head}
    <title>${title}</title>
    <style>
${buildStyle(body, connections)}
    </style>
  </head>
  <body>
    <h1 class="hz-title">${title}</h1>
    <article class="hz-prose">${body ? `\n${body}\n    ` : ""}</article>
${connections}
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
export function serializeNoteToHtmlDocument(
  note: Note,
  related?: RelatedNoteView[]
): string {
  return renderDocument(
    renderMetaTags(note),
    escapeHtml(note.title),
    formatNoteBody(sanitizeNoteContent(note.content)),
    renderVisibleConnections(note, related)
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
    content: unformatNoteBody(sanitizeNoteContent(body.innerHTML)),
    recallPrompt: readMeta(doc, "recallPrompt"),
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
 * Converte um HTML externo sem `hz:id` numa nota pertencente ao vault.
 * O conteúdo passa pelo mesmo sanitizer do editor e nasce na Entrada como
 * captura fugaz, para que a origem externa percorra o fluxo de processamento.
 * Documentos que já possuem identidade não são adotados por esta função.
 */
export function adoptHtmlDocumentAsNote(
  html: string,
  options: { id?: string; now?: string } = {}
): Note | null {
  if (typeof html !== "string" || !html.trim()) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (readMeta(doc, "id")) return null;

  const body = doc.body.querySelector(".hz-prose") ?? doc.body;
  const content = unformatNoteBody(sanitizeNoteContent(body.innerHTML));
  const title = readTitle(doc);
  if (!title && !content.trim()) return null;

  const now = options.now ?? new Date().toISOString();
  return createNoteRecord({
    id: options.id ?? createId(),
    title,
    content,
    folder: "inbox",
    kind: "fleeting",
    template: "blank",
    status: "saved",
    createdAt: now,
    updatedAt: now
  });
}

/**
 * Nome convencional para uma nota criada pelo aplicativo:
 * `<timestamp>--<titulo>--<id-curto>.html`.
 * Arquivos encontrados no vault podem ter qualquer outro nome seguro; o
 * `hz:id` dentro do HTML é a identidade da nota e o índice preserva o nome
 * físico real.
 *
 * O timestamp usa UTC para que o mesmo `createdAt` produza o mesmo nome em
 * máquinas com fusos diferentes. Depois do primeiro salvamento, o índice
 * preserva o nome físico mesmo que o título mude.
 */
export function noteFileName(note: Pick<Note, "id" | "title" | "createdAt">): string {
  const createdAt = new Date(note.createdAt);
  const timestamp = Number.isNaN(createdAt.getTime())
    ? "00000000-000000"
    : [
        createdAt.getUTCFullYear().toString().padStart(4, "0"),
        (createdAt.getUTCMonth() + 1).toString().padStart(2, "0"),
        createdAt.getUTCDate().toString().padStart(2, "0"),
        "-",
        createdAt.getUTCHours().toString().padStart(2, "0"),
        createdAt.getUTCMinutes().toString().padStart(2, "0"),
        createdAt.getUTCSeconds().toString().padStart(2, "0")
      ].join("");
  const shortId =
    note.id
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8) || "note";
  return `${timestamp}--${slugify(note.title)}--${shortId}.html`;
}
