/**
 * Decide qual nota persistida pode ser restaurada na inicialização.
 *
 * O rascunho vazio criado em memória nunca é um candidato: ele ainda não
 * existe no índice. Um hash explícito tem prioridade, mas, se estiver
 * obsoleto, não abrimos silenciosamente outra nota da sessão anterior.
 */
export function selectInitialNoteId(
  notes: readonly { id: string }[],
  hashId: string,
  sessionId: string | null
): string | null {
  const ids = new Set(notes.map((note) => note.id));

  if (hashId) {
    if (hashId === "novo") return null;
    return ids.has(hashId) ? hashId : null;
  }

  return sessionId && ids.has(sessionId) ? sessionId : null;
}
