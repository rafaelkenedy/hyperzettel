/**
 * Retenção e agendamento de revisões.
 *
 * Depende de `useNotes` para saber o que existe, e nada depende dele — a
 * coleção continua funcionando se este provider sair.
 */

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

import {
  createKnowledgeModel,
  type CurvePoint,
  type KnowledgeModel,
  type KnowledgeSnapshot,
  type NoteInfo,
  REVIEW_QUALITIES,
  type Quality
} from "@/features/knowledge";
import type { Note } from "@/domain/notes";
import { vaultRepository } from "@/infrastructure/vaultRepository";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useNotes } from "@/app/providers/NotesProvider";

export interface KnowledgeStore {
  snapshot: KnowledgeSnapshot;
  /** Retenção da nota aberta no editor, quando ela já existe no mapa. */
  activeRetention: NoteInfo | null;
  reviewNote: (id: string, quality?: Quality) => Promise<void>;
  reviewActiveNote: (quality?: Quality) => Promise<void>;
  /** Intervalos que cada resposta produziria para a nota indicada. */
  previewIntervals: (id: string) => Record<number, number>;
  curve: (days: number | "all") => CurvePoint[];
  /** Exporta e mescla o histórico; usado pelo backup. */
  exportState: () => ReturnType<KnowledgeModel["exportState"]>;
  mergeImported: (state: unknown, notes: Note[]) => Promise<void>;
}

const KnowledgeContext = createContext<KnowledgeStore | null>(null);

export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const { announce } = useAnnouncer();
  const { savedNotes, draft, ready, persistDraft, currentNote } = useNotes();

  /*
   * O modelo é estado mutável de longa duração e vive num ref, não no escopo
   * do módulo: como singleton de módulo, o Fast Refresh recriava o modelo
   * vazio enquanto os refs do componente sobreviviam, e a sincronia gravava
   * esse vazio por cima do histórico real.
   */
  const modelRef = useRef<KnowledgeModel | null>(null);
  if (!modelRef.current) modelRef.current = createKnowledgeModel(null);
  const model = modelRef.current;

  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>(() => model.snapshot());
  /** Só grava depois de ler o que já estava salvo. */
  const hydratedRef = useRef(false);

  const persist = useCallback(async () => {
    if (!hydratedRef.current) return;
    try {
      await vaultRepository.setRetention(model.exportState());
    } catch (error) {
      console.error(error);
    }
  }, [model]);

  // Hidratação: lê o histórico gravado antes de qualquer sincronia.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await vaultRepository.getRetention();
        if (cancelled) return;
        if (stored) model.importState(stored);
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setSnapshot(model.snapshot());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [model]);

  /**
   * Mantém o mapa alinhado à coleção. Só roda depois da carga das notas, para
   * não sincronizar com o dataset de placeholder.
   *
   * A gravação é condicionada à hidratação: sem essa trava, um modelo ainda
   * vazio sobrescreveria todo o histórico de revisões, que é o único dado do
   * app que não dá para reconstruir a partir das notas.
   */
  useEffect(() => {
    if (!ready) return;
    setSnapshot(model.sync(savedNotes));
    void persist();
  }, [savedNotes, ready, model, persist]);

  const reviewNote = useCallback(
    async (id: string, quality: Quality = 4) => {
      const result = model.reviewNote(id, quality);
      if (!result.ok) {
        announce("Esta nota ainda não faz parte do mapa de conhecimento.");
        return;
      }
      if (result.repeated) {
        announce("Esta nota já foi revisada agora há pouco.");
        return;
      }

      setSnapshot(model.snapshot());
      await persist();
      announce(
        result.reinforcedEdges
          ? `Nota revisada. ${result.reinforcedEdges} ${result.reinforcedEdges === 1 ? "conexão reforçada" : "conexões reforçadas"}.`
          : "Nota revisada."
      );
    },
    [announce, model, persist]
  );

  const reviewActiveNote = useCallback(
    async (quality: Quality = 4) => {
      // A nota precisa existir no disco antes de entrar no agendamento.
      await persistDraft();
      await reviewNote(currentNote?.id ?? draft.id, quality);
    },
    [currentNote?.id, draft.id, persistDraft, reviewNote]
  );

  const mergeImported = useCallback(
    async (state: unknown, notes: Note[]) => {
      if (state) model.importState(state, true);
      setSnapshot(model.sync(notes));
      await persist();
    },
    [model, persist]
  );

  const activeRetention = useMemo(
    () => snapshot.notes.find((note) => note.id === draft.id) ?? null,
    [snapshot, draft.id]
  );

  const value = useMemo<KnowledgeStore>(
    () => ({
      snapshot,
      activeRetention,
      reviewNote,
      reviewActiveNote,
      previewIntervals: (id: string) => model.previewFor(id, REVIEW_QUALITIES),
      curve: model.curve,
      exportState: model.exportState,
      mergeImported
    }),
    [snapshot, activeRetention, reviewNote, reviewActiveNote, mergeImported, model]
  );

  return <KnowledgeContext.Provider value={value}>{children}</KnowledgeContext.Provider>;
}

export function useKnowledge(): KnowledgeStore {
  const context = useContext(KnowledgeContext);
  if (!context) throw new Error("useKnowledge precisa estar dentro de <KnowledgeProvider>.");
  return context;
}
