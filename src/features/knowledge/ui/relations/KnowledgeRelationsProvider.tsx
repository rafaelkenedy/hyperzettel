import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import type { Note } from "@/domain/notes";
import type { NoteRelation, RelationStatus } from "@/features/knowledge/domain/relations";
import {
  getRelatedNotes,
  getRelationStatus,
  nativeRelationsAvailable,
  pauseKnowledgeRelations,
  rebuildKnowledgeRelations,
  rejectAutomaticRelation,
  restoreAutomaticRelation,
  resumeKnowledgeRelations,
  subscribeToRelationEvents,
  syncKnowledgeNotes
} from "@/features/knowledge/application/relations";

export type RelatedNoteItem = { relation: NoteRelation; note: Note };

type RelationsContextValue = {
  status: RelationStatus;
  related: RelatedNoteItem[];
  activeNote: Note | null;
  rebuild: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  retry: () => Promise<void>;
  reject: (relation: NoteRelation) => Promise<void>;
  restore: (relation: NoteRelation) => Promise<void>;
  open: (noteId: string) => void;
  connect: (noteId: string) => void;
};

const RelationsContext = createContext<RelationsContextValue | null>(null);

export function KnowledgeRelationsProvider({
  notes,
  activeNoteId,
  connectedNoteIds,
  ready,
  onOpen,
  onConnect,
  children
}: {
  notes: readonly Note[];
  activeNoteId: string;
  connectedNoteIds: readonly string[];
  ready: boolean;
  onOpen: (noteId: string) => void;
  onConnect: (noteId: string) => void;
  children: ReactNode;
}) {
  const notesRef = useRef(notes);
  const startedRef = useRef(false);
  const [status, setStatus] = useState<RelationStatus>({ type: "idle" });
  const [revision, setRevision] = useState(0);
  const [related, setRelated] = useState<RelatedNoteItem[]>([]);
  notesRef.current = notes;

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getRelationStatus());
    } catch {
      setStatus({
        type: "error",
        code: "COMMAND_FAILED",
        message: "Não foi possível consultar a análise local.",
        retryable: true
      });
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: () => void = () => undefined;
    void refreshStatus();
    void subscribeToRelationEvents(() => {
      if (disposed) return;
      setRevision((value) => value + 1);
      void refreshStatus();
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (!ready || !nativeRelationsAvailable()) return;
    const initialRebuild = !startedRef.current;
    if (initialRebuild) {
      startedRef.current = true;
    }
    void syncKnowledgeNotes(notes, true)
      .then(() => (initialRebuild ? rebuildKnowledgeRelations() : undefined))
      .catch(() => {
        setStatus({
          type: "error",
          code: "SYNC_FAILED",
          message: "Não foi possível preparar as notas para a análise local.",
          retryable: true
        });
      });
  }, [notes, ready]);

  useEffect(() => {
    let cancelled = false;
    void getRelatedNotes(activeNoteId)
      .then((relations) => {
        if (cancelled) return;
        const byId = new Map(notes.map((note) => [note.id, note]));
        const connected = new Set(connectedNoteIds);
        setRelated(
          relations.flatMap((relation) => {
            const otherId =
              relation.firstNoteId === activeNoteId
                ? relation.secondNoteId
                : relation.firstNoteId;
            const note = byId.get(otherId);
            return note && !connected.has(otherId) ? [{ relation, note }] : [];
          })
        );
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeNoteId, connectedNoteIds, notes, revision]);

  const rebuild = useCallback(async () => {
    await syncKnowledgeNotes(notesRef.current, true);
    await rebuildKnowledgeRelations();
    await refreshStatus();
  }, [refreshStatus]);
  const retry = rebuild;
  const resume = useCallback(async () => {
    await resumeKnowledgeRelations();
    await refreshStatus();
  }, [refreshStatus]);
  const open = useCallback((noteId: string) => onOpen(noteId), [onOpen]);
  const connect = useCallback((noteId: string) => onConnect(noteId), [onConnect]);
  const value = useMemo<RelationsContextValue>(
    () => ({
      status,
      related,
      activeNote: notes.find((note) => note.id === activeNoteId) ?? null,
      rebuild,
      pause: () => {
        void pauseKnowledgeRelations().then(refreshStatus);
      },
      resume,
      retry,
      reject: async (relation) => {
        await rejectAutomaticRelation(relation);
        setRevision((value) => value + 1);
      },
      restore: async (relation) => {
        await restoreAutomaticRelation(relation);
        setRevision((value) => value + 1);
      },
      open,
      connect
    }),
    [status, related, notes, activeNoteId, rebuild, resume, retry, refreshStatus, open, connect]
  );

  return <RelationsContext.Provider value={value}>{children}</RelationsContext.Provider>;
}

// eslint-disable-next-line react/only-export-components -- provider e hook formam uma única API pública.
export function useKnowledgeRelations(): RelationsContextValue {
  const context = useContext(RelationsContext);
  if (!context) throw new Error("useKnowledgeRelations requer KnowledgeRelationsProvider.");
  return context;
}
