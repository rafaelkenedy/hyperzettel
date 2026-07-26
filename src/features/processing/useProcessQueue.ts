/**
 * Controle da fila de processamento.
 *
 * A nota em foco é fixada por id, não por posição: cada resposta grava a nota
 * e atualiza `updatedAt`, o que reordena a fila. Indexar por posição fazia a
 * nota escapar do meio do fluxo e outra tomar seu lugar.
 *
 * `handled` guarda o que já foi resolvido ou pulado nesta sessão, para a fila
 * andar sempre para a frente e o "pular" não entrar em loop.
 */

import { useEffect, useMemo, useState } from "react";

import { useNotes } from "@/app/providers/NotesProvider";
import type { Note } from "@/domain/notes";

export function selectProcessNote(
  processQueue: readonly Note[],
  allNotes: readonly Note[],
  activeId: string | null,
  handled: ReadonlySet<string>
): Note | undefined {
  // A nota ativa permanece fixada mesmo depois de ser promovida e sair da
  // fila. Sem isso, o passo "conectar" desaparece logo após virar permanente.
  const pinned = activeId ? allNotes.find((item) => item.id === activeId) : undefined;
  if (pinned) return pinned;
  return processQueue.find((item) => !handled.has(item.id));
}

export function useProcessQueue() {
  const { processQueue, notes } = useNotes();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [processed, setProcessed] = useState(0);

  const note: Note | undefined = useMemo(() => {
    return selectProcessNote(processQueue, notes, activeId, handled);
  }, [processQueue, notes, activeId, handled]);

  useEffect(() => {
    if (note && note.id !== activeId) setActiveId(note.id);
    if (!note && activeId) setActiveId(null);
  }, [note, activeId]);

  function release(id: string) {
    setHandled((previous) => new Set(previous).add(id));
    setActiveId(null);
  }

  return {
    note,
    activeId,
    queueLength:
      note && !processQueue.some((candidate) => candidate.id === note.id)
        ? processQueue.length + 1
        : processQueue.length,
    processed,
    /** Conclui a nota atual e libera a fila para a próxima. */
    complete: () => {
      if (!note) return;
      release(note.id);
      setProcessed((total) => total + 1);
    },
    /** Deixa a nota como está; não conta como processada. */
    skip: () => {
      if (note) release(note.id);
    }
  };
}
