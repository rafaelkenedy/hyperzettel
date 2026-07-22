/**
 * Utilitários de data usados pelo modelo de conhecimento.
 * Porte de `src/shared/dates.js` do Hyperzettelkasten.
 */

export function isValidDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function safeDate(value: unknown, fallback = new Date().toISOString()): string {
  return isValidDate(value) ? value : fallback;
}

/** Impede datas no futuro — o seed traz registros já datados. */
export function dateNotAfter(value: unknown, ceiling: number = Date.now()): string {
  return new Date(Math.min(Date.parse(safeDate(value)), ceiling)).toISOString();
}

export function latestDate(...values: unknown[]): string {
  return (
    values
      .filter(isValidDate)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ??
    new Date().toISOString()
  );
}
