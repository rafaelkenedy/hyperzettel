/**
 * Importação e exportação de backup JSON.
 *
 * No modelo de arquivo as imagens vivem **inline** no HTML da nota,
 * então o backup não tem mais um array de imagens à parte no export. A
 * importação ainda aceita os formatos anteriores:
 *
 * - `hyperzettelkasten` v2 — notas + imagens (por `data-image-id`) + retenção;
 * - `hyperzettelkasten` v1 — notas com `links` e pastas `"00 Inbox"`;
 * - `hyperzettel-notes` v1 — o formato legado enxuto;
 * - o formato novo — notas já com imagens embutidas em base64.
 *
 * Imagens de backups antigos são embutidas no conteúdo **antes** da sanitização,
 * senão o sanitizer (que só aceita `src` data-URI) as descartaria.
 */

import { normalizeImportedNote, type Note } from "@/domain/notes";
import type { KnowledgeState } from "@/features/knowledge";
import { sanitizeNoteContent } from "@/shared/html";
import { parseHtmlDocumentToNote } from "@/shared/noteDocument";
import type { VaultRepository } from "@/infrastructure/vaultRepository";

const FOLDER_MAP: Record<string, string> = {
  "00 Inbox": "inbox",
  "01 Projects": "projects",
  "02 Areas": "areas",
  "03 Resources": "resources",
  "04 Archive": "archive",
  "05 Daily": "journal"
};

const BACKUP_FORMAT = "hyperzettelkasten";
const BACKUP_VERSION = 2;
const LEGACY_FORMAT = "hyperzettel-notes";
const MAX_BACKUP_SIZE = 120_000_000;

/**
 * Traduz uma nota do esquema antigo para o atual: `links` viram `connections`,
 * pastas `"01 Projects"` viram `projects`. Notas já no formato novo passam
 * intactas.
 */
function toCurrentSchema(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = { ...(value as Record<string, unknown>) };

  if (source.links !== undefined && source.connections === undefined) {
    source.connections = source.links;
  }
  if (typeof source.folder === "string" && FOLDER_MAP[source.folder]) {
    source.folder = FOLDER_MAP[source.folder];
  }
  // O esquema antigo não tinha estado de rascunho: tudo importado é nota salva.
  if (source.status === undefined) source.status = "saved";

  return source;
}

/** Mapa `data-image-id` -> data-URI base64 a partir do array de imagens do v2. */
function buildImageMap(images: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(images)) return map;
  for (const entry of images) {
    if (!entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const data = typeof source.data === "string" ? source.data : "";
    if (id && /^data:image\//i.test(data)) map.set(id, data);
  }
  return map;
}

/** Embute as imagens do backup v2 no conteúdo cru, antes da sanitização. */
function inlineImages(html: unknown, images: Map<string, string>): string {
  if (typeof html !== "string" || !html || images.size === 0) {
    return typeof html === "string" ? html : "";
  }
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll<HTMLImageElement>("img[data-image-id]").forEach((image) => {
    const data = images.get(image.dataset.imageId ?? "");
    image.removeAttribute("data-image-id");
    if (data) image.setAttribute("src", data);
    else image.remove();
  });
  return container.innerHTML;
}

export interface ExportResult {
  noteCount: number;
  blob: Blob;
  fileName: string;
}

export interface ImportResult {
  notes: Note[];
  knowledge: unknown | null;
}

export interface BackupDeps {
  vault: VaultRepository;
  exportKnowledge: () => KnowledgeState;
}

export function createBackupService({ vault, exportKnowledge }: BackupDeps) {
  async function exportBackup(): Promise<ExportResult> {
    const documents = await vault.readAllDocuments();
    const notes = documents
      .map((document) => parseHtmlDocumentToNote(document.html))
      .filter((note): note is Note => note !== null);

    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      notes,
      knowledge: exportKnowledge()
    };

    return {
      noteCount: notes.length,
      blob: new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      fileName: `hyperzettel-notas-${new Date().toISOString().slice(0, 10)}.json`
    };
  }

  function parseBackup(source: string): { notes: Note[]; knowledge: unknown | null } {
    const parsed = JSON.parse(source);
    const sourceNotes = Array.isArray(parsed) ? parsed : parsed?.notes;
    if (!Array.isArray(sourceNotes)) {
      throw new Error("O arquivo não contém uma coleção de notas válida.");
    }

    const format = Array.isArray(parsed) ? null : parsed?.format;
    if (format && format !== BACKUP_FORMAT && format !== LEGACY_FORMAT) {
      throw new Error(`Formato de backup não reconhecido: ${String(format)}.`);
    }

    const images = buildImageMap(parsed?.images);
    const notes = sourceNotes
      .map((value) => {
        const schema = toCurrentSchema(value);
        if (!schema) return null;
        schema.content = inlineImages(schema.content, images);
        return normalizeImportedNote(schema, { sanitizeContent: sanitizeNoteContent });
      })
      .filter((note): note is Note => note !== null);

    if (sourceNotes.length && !notes.length) {
      throw new Error("Nenhuma nota válida foi encontrada no arquivo.");
    }

    return { notes, knowledge: parsed?.knowledge ?? null };
  }

  async function importBackup(file: File | null): Promise<ImportResult | null> {
    if (!file) return null;
    if (file.size > MAX_BACKUP_SIZE) {
      throw new Error("O arquivo de notas excede o limite de 120 MB.");
    }
    const backup = parseBackup(await file.text());
    for (const note of backup.notes) await vault.save(note);
    if (backup.knowledge) await vault.setRetention(backup.knowledge);
    return { notes: backup.notes, knowledge: backup.knowledge };
  }

  return { exportBackup, importBackup };
}

export type BackupService = ReturnType<typeof createBackupService>;
