/**
 * Importação e exportação de backup JSON.
 *
 * O formato exportado é `hyperzettelkasten` v2, o mesmo do projeto original,
 * incluindo o histórico de aprendizagem. A importação aceita três formatos:
 *
 * - `hyperzettelkasten` v2 — notas + estado de retenção;
 * - `hyperzettelkasten` v1 — notas com `links` e pastas `"00 Inbox"`;
 * - `hyperzettel-notes` v1 — o formato legado enxuto.
 *
 * Assim um backup gerado em qualquer uma das versões anteriores entra aqui.
 */

import { normalizeDate, normalizeImportedNote, type Note } from "@/domain/notes";
import type { KnowledgeState } from "@/features/knowledge";
import { sanitizeNoteContent } from "@/shared/html";
import type { NoteRepository, StoredImage } from "@/infrastructure/noteRepository";

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
const MAX_IMAGE_DATA_SIZE = 28_000_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(value: unknown): Blob {
  if (
    typeof value !== "string" ||
    !/^data:image\/[a-z0-9.+-]+;base64,/i.test(value) ||
    value.length > MAX_IMAGE_DATA_SIZE
  ) {
    throw new Error("Imagem inválida no arquivo de notas.");
  }
  const [header, encoded] = value.split(",", 2);
  const type = header.match(/^data:([^;]+)/i)?.[1] ?? "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

/**
 * Traduz uma nota vinda do esquema antigo para o atual: `links` viram
 * `connections` e pastas `"01 Projects"` viram `projects`. Notas já no
 * formato novo passam intactas.
 */
function toCurrentSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
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

export interface ExportResult {
  noteCount: number;
  blob: Blob;
  fileName: string;
}

export interface ImportResult {
  notes: Note[];
  imageCount: number;
  knowledge: unknown | null;
}

export interface BackupDeps {
  repository: NoteRepository;
  exportKnowledge: () => KnowledgeState;
}

export function createBackupService({ repository, exportKnowledge }: BackupDeps) {
  function parseBackup(source: string): {
    notes: Note[];
    images: unknown[];
    knowledge: unknown | null;
  } {
    const parsed = JSON.parse(source);
    const sourceNotes = Array.isArray(parsed) ? parsed : parsed?.notes;
    if (!Array.isArray(sourceNotes)) {
      throw new Error("O arquivo não contém uma coleção de notas válida.");
    }

    const format = Array.isArray(parsed) ? null : parsed?.format;
    if (format && format !== BACKUP_FORMAT && format !== LEGACY_FORMAT) {
      throw new Error(`Formato de backup não reconhecido: ${String(format)}.`);
    }

    const notes = sourceNotes
      .map((value) =>
        normalizeImportedNote(toCurrentSchema(value), { sanitizeContent: sanitizeNoteContent })
      )
      .filter((note): note is Note => note !== null);

    if (sourceNotes.length && !notes.length) {
      throw new Error("Nenhuma nota válida foi encontrada no arquivo.");
    }

    return {
      notes,
      images: Array.isArray(parsed?.images) ? parsed.images : [],
      knowledge: parsed?.knowledge ?? null
    };
  }

  function normalizeImage(value: unknown): StoredImage {
    if (!value || typeof value !== "object") {
      throw new Error("Registro de imagem inválido no arquivo de notas.");
    }
    const source = value as Record<string, unknown>;
    if (typeof source.id !== "string" || !source.id.trim()) {
      throw new Error("Registro de imagem inválido no arquivo de notas.");
    }
    return {
      id: source.id.trim(),
      blob: dataUrlToBlob(source.data),
      name: typeof source.name === "string" ? source.name.slice(0, 240) : "Imagem da nota",
      type: typeof source.type === "string" ? source.type : "image/*",
      createdAt: normalizeDate(source.createdAt, new Date().toISOString())
    };
  }

  async function exportBackup(): Promise<ExportResult> {
    const [notes, images] = await Promise.all([
      repository.getAllNotes(),
      repository.getAllImages()
    ]);
    const serializedImages = await Promise.all(
      images.map(async (image) => ({
        id: image.id,
        name: image.name || "Imagem da nota",
        type: image.type || image.blob?.type || "application/octet-stream",
        createdAt: image.createdAt || new Date().toISOString(),
        data: await blobToDataUrl(image.blob)
      }))
    );

    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      notes,
      images: serializedImages,
      knowledge: exportKnowledge()
    };

    return {
      noteCount: notes.length,
      blob: new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      fileName: `hyperzettel-notas-${new Date().toISOString().slice(0, 10)}.json`
    };
  }

  async function importBackup(file: File | null): Promise<ImportResult | null> {
    if (!file) return null;
    if (file.size > MAX_BACKUP_SIZE) {
      throw new Error("O arquivo de notas excede o limite de 120 MB.");
    }
    const backup = parseBackup(await file.text());
    const images = backup.images.map(normalizeImage);
    for (const note of backup.notes) await repository.putNote(note);
    for (const image of images) await repository.putImage(image);
    return { notes: backup.notes, imageCount: images.length, knowledge: backup.knowledge };
  }

  return { exportBackup, importBackup };
}

export type BackupService = ReturnType<typeof createBackupService>;
