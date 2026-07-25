/**
 * Otimização de imagem antes de persistir.
 * Porte de `src/infrastructure/image-optimizer.js`.
 *
 * Sem isto, uma foto de celular de 8 MB entraria inteira, em base64, no HTML
 * auto-contido da nota. Redimensiona e recodifica em WebP antes.
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

export interface OptimizedDataUrl {
  dataUrl: string;
  width: number;
  height: number;
}

function assertEncodable(file: File): void {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error(`Tipo "${file.type}" não suportado. Use JPG, PNG ou WebP.`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `Imagem de ${(file.size / 1024 / 1024).toFixed(1)} MB excede o limite de 12 MB.`
    );
  }
}

/** Desenha a fonte no tamanho pedido e recodifica em WebP, baixando a qualidade
 *  uma vez se o resultado passar do teto. */
function renderWebpDataUrl(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Não foi possível preparar a imagem.");
  context.drawImage(source, 0, 0, width, height);

  let dataUrl = canvas.toDataURL("image/webp", 0.82);
  if (dataUrl.length > MAX_ENCODED_LENGTH) dataUrl = canvas.toDataURL("image/webp", 0.64);
  if (dataUrl.length > MAX_ENCODED_LENGTH) {
    throw new Error("A imagem ainda ficou grande demais após a otimização.");
  }
  return dataUrl;
}

/**
 * Reduz o maior lado para 1600 px e recodifica em WebP, devolvendo o data-URI.
 * É a forma usada no modelo auto-contido: a imagem entra embutida
 * no HTML da nota, sem armazenamento separado.
 *
 * @example (await optimizeImageToDataUrl(file)).dataUrl // "data:image/webp;base64,…"
 */
export async function optimizeImageToDataUrl(file: File): Promise<OptimizedDataUrl> {
  assertEncodable(file);
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) {
      throw new Error("Não foi possível ler as dimensões da imagem.");
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    return { dataUrl: renderWebpDataUrl(decoded.source, width, height), width, height };
  } finally {
    decoded.release();
  }
}
