import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const blueprintPath = path.join(
  repositoryRoot,
  "src",
  "seed",
  "retrieval-benchmark-vault.json"
);
const targetDirectory = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, ".benchmark-vault")
);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function deterministicUuid(key) {
  const bytes = createHash("sha256").update(`hyperzettel-benchmark:${key}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function meta(name, content) {
  return `    <meta name="hz:${name}" content="${escapeHtml(content)}">`;
}

function renderDocument(note, ids, index) {
  const id = ids.get(note.key);
  const created = new Date(Date.UTC(2026, 0, 1, 12, index, 0)).toISOString();
  const title = escapeHtml(note.title);
  const connections = note.links.map((key) =>
    meta("connection", `${ids.get(key)}|Relação manual do corpus de avaliação.`)
  );
  const head = [
    meta("id", id),
    meta("folder", note.folder),
    meta("kind", note.kind),
    meta("template", "concept"),
    meta("status", "saved"),
    meta("createdAt", created),
    meta("updatedAt", created),
    ...connections
  ].join("\n");
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
${head}
    <title>${title}</title>
    <style>
      body { max-width: 760px; margin: 3rem auto; padding: 0 1.5rem; font-family: system-ui, sans-serif; line-height: 1.65; color: #17201d; }
      .hz-title { line-height: 1.2; }
    </style>
  </head>
  <body>
    <h1 class="hz-title">${title}</h1>
    <article class="hz-prose">${note.content}</article>
  </body>
</html>
`;
}

const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
const ids = new Map(blueprint.notes.map((note) => [note.key, deterministicUuid(note.key)]));
for (const note of blueprint.notes) {
  for (const target of note.links) {
    if (!ids.has(target)) throw new Error(`Conexão desconhecida: ${note.key} -> ${target}`);
  }
}

await mkdir(targetDirectory, { recursive: true });

for (const [index, note] of blueprint.notes.entries()) {
  const id = ids.get(note.key);
  const timestamp = `20260101-${String(120000 + index).padStart(6, "0")}`;
  const fileName = `${timestamp}--${slugify(note.title)}--${id.replaceAll("-", "").slice(0, 8)}.html`;
  await writeFile(
    path.join(targetDirectory, fileName),
    renderDocument(note, ids, index),
    "utf8"
  );
}

console.log(`${blueprint.notes.length} notas HTML criadas em ${targetDirectory}`);
