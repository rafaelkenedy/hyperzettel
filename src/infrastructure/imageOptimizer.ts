/**
 * Otimização de imagem antes de persistir.
 * Porte de `src/infrastructure/image-optimizer.js`.
 *
 * Sem isto, uma foto de celular de 8 MB ia inteira para o IndexedDB e para
 * dentro do backup JSON em base64.
 */

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1600;
const MAX_ENCODED_LENGTH = 1_800_000;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function dataUrlToBlob(dataURL: string): Blob {
  const [header, encoded] = dataURL.split(",", 2);
  const type = header.match(/^data:([^;]+)/i)?.[1] ?? "image/webp";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
}

export interface OptimizedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Reduz o maior lado para 1600 px e recodifica em WebP. Se ainda passar do
 * teto, tenta uma qualidade menor antes de desistir.
 */
export async function optimizeImage(file: File): Promise<OptimizedImage> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("Use uma imagem JPG, PNG ou WebP.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("A imagem original deve ter no máximo 12 MB.");
  }

  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new Error("Não foi possível ler as dimensões da imagem.");
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.drawImage(decoded.source, 0, 0, width, height);

    let dataURL = canvas.toDataURL("image/webp", 0.82);
    if (dataURL.length > MAX_ENCODED_LENGTH) dataURL = canvas.toDataURL("image/webp", 0.64);
    if (dataURL.length > MAX_ENCODED_LENGTH) {
      throw new Error("A imagem ainda ficou grande demais após a otimização.");
    }

    return { blob: dataUrlToBlob(dataURL), width, height };
  } finally {
    decoded.release();
  }
}
