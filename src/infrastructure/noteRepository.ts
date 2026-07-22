/**
 * Persistência local em IndexedDB. Porte de `scripts/infrastructure/indexeddb.js`.
 * O banco `hyperzettel` mantém os stores `notes` e `images`; imagens são
 * gravadas como Blob e o HTML da nota guarda apenas `data-image-id`.
 */

import { createId, type Note } from "@/domain/notes";
import { optimizeImage } from "@/infrastructure/imageOptimizer";

const DB_NAME = "hyperzettel";
/** v4 remove o cache semântico antigo; relações agora pertencem ao SQLite nativo. */
const DB_VERSION = 4;
const NOTE_STORE = "notes";
const IMAGE_STORE = "images";
const KNOWLEDGE_STORE = "knowledge";
const KNOWLEDGE_KEY = "state";
const LEGACY_RELATION_STORES = [
  "note_embeddings",
  "note_relations",
  "rejected_relations",
  "relation_state"
] as const;

export interface StoredImage {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: string;
}

let databasePromise: Promise<IDBDatabase> | undefined;

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(NOTE_STORE)) {
        const notes = database.createObjectStore(NOTE_STORE, { keyPath: "id" });
        notes.createIndex("updatedAt", "updatedAt");
        notes.createIndex("folder", "folder");
      }

      if (!database.objectStoreNames.contains(IMAGE_STORE)) {
        database.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(KNOWLEDGE_STORE)) {
        database.createObjectStore(KNOWLEDGE_STORE);
      }

      LEGACY_RELATION_STORES.forEach((storeName) => {
        if (database.objectStoreNames.contains(storeName)) {
          database.deleteObjectStore(storeName);
        }
      });
    });

    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("A atualização do banco local foi bloqueada.")),
      { once: true }
    );
  });

  return databasePromise;
}

/** Abre uma transação, executa a operação e só resolve quando ela conclui. */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, mode);
  const result = await operation(transaction.objectStore(storeName));

  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });

  return result;
}

export function putNote(note: Note): Promise<IDBValidKey> {
  return withStore(NOTE_STORE, "readwrite", (store) => requestAsPromise(store.put(note)));
}

/** Gravação em lote numa única transação — usada pelo seed inicial. */
export async function putNotes(notes: Note[]): Promise<number> {
  if (!Array.isArray(notes) || notes.length === 0) return 0;
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(NOTE_STORE, "readwrite");
    const store = transaction.objectStore(NOTE_STORE);
    notes.forEach((note) => store.put(note));
    transaction.addEventListener("complete", () => resolve(notes.length), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export function getNote(id: string): Promise<Note | undefined> {
  return withStore(NOTE_STORE, "readonly", (store) =>
    requestAsPromise<Note | undefined>(store.get(id))
  );
}

export function getAllNotes(): Promise<Note[]> {
  return withStore(NOTE_STORE, "readonly", (store) =>
    requestAsPromise<Note[]>(store.getAll())
  );
}

export function deleteNote(id: string): Promise<undefined> {
  return withStore(NOTE_STORE, "readwrite", (store) => requestAsPromise(store.delete(id)));
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return withStore(IMAGE_STORE, "readwrite", (store) => requestAsPromise(store.put(image)));
}

export function getImage(id: string): Promise<StoredImage | undefined> {
  return withStore(IMAGE_STORE, "readonly", (store) =>
    requestAsPromise<StoredImage | undefined>(store.get(id))
  );
}

export function getAllImages(): Promise<StoredImage[]> {
  return withStore(IMAGE_STORE, "readonly", (store) =>
    requestAsPromise<StoredImage[]>(store.getAll())
  );
}

/**
 * Toda imagem passa pelo otimizador antes de ser gravada: o que entra no
 * IndexedDB (e depois no backup em base64) é a versão WebP redimensionada,
 * nunca o arquivo original.
 */
export async function saveImage(file: File): Promise<StoredImage> {
  const optimized = await optimizeImage(file);
  const image: StoredImage = {
    id: createId("image"),
    blob: optimized.blob,
    name: file.name || "Imagem da nota",
    type: optimized.blob.type,
    createdAt: new Date().toISOString()
  };
  await putImage(image);
  return image;
}

/**
 * Estado de retenção. Fica num store de chave avulsa porque é um documento
 * único, não uma coleção — sempre lido e gravado inteiro.
 */
export function loadKnowledge(): Promise<unknown> {
  return withStore(KNOWLEDGE_STORE, "readonly", (store) =>
    requestAsPromise<unknown>(store.get(KNOWLEDGE_KEY))
  );
}

export function saveKnowledge(state: unknown): Promise<IDBValidKey> {
  return withStore(KNOWLEDGE_STORE, "readwrite", (store) =>
    requestAsPromise(store.put(state, KNOWLEDGE_KEY))
  );
}

export const noteRepository = {
  openDatabase,
  loadKnowledge,
  saveKnowledge,
  putNote,
  putNotes,
  getNote,
  getAllNotes,
  deleteNote,
  putImage,
  getImage,
  getAllImages,
  saveImage
};

export type NoteRepository = typeof noteRepository;
