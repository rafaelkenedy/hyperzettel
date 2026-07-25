/**
 * Slug ASCII legível a partir de um texto livre — usado tanto no cabeçalho do
 * editor quanto no nome do arquivo da nota, então mora aqui para não
 * duplicar a regra.
 */

/** Limite que mantém cabeçalho e nome de arquivo curtos e legíveis. */
const MAX_SLUG_LENGTH = 48;

/** Faixa Unicode dos diacríticos combinantes, removidos após normalizar em NFD. */
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

/**
 * Converte um texto em um identificador legível em minúsculas, sem acentos.
 *
 * @example slugify("Olá, Mundo!") // "ola-mundo"
 * @example slugify("") // "sem-titulo"
 */
export function slugify(value: string, fallback = "sem-titulo"): string {
  const slug = value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug || fallback;
}
