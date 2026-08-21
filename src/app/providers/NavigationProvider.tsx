/**
 * Qual tela da área principal está visível.
 *
 * Não depende de nada: é só roteamento interno. Manter separado evita que
 * trocar de aba no mapa re-renderize a coleção de notas.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type WorkspaceView = "home" | "note" | "map" | "process";

/** Abas do painel lateral do mapa; o grafo fica sempre visível ao lado. */
export type MapTab = "explore" | "curve" | "review";

interface Navigation {
  view: WorkspaceView;
  mapTab: MapTab;
  /** Nota pedida explicitamente pelo editor para uma revisão avulsa. */
  reviewTargetId: string | null;
  setView: (view: WorkspaceView) => void;
  setMapTab: (tab: MapTab) => void;
  /** Abre o mapa, ou volta para a tela anterior se ele já estiver aberto. */
  toggleMap: (tab?: MapTab) => void;
  /** Abre uma sessão de revisão avulsa para a nota, mesmo antes do vencimento. */
  openReview: (noteId: string) => void;
  clearReviewTarget: () => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<WorkspaceView>("home");
  const [mapTab, setMapTab] = useState<MapTab>("explore");
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null);
  /** Para onde voltar quando o mapa é fechado. */
  const previousViewRef = useRef<WorkspaceView>("home");

  const toggleMap = useCallback((tab?: MapTab) => {
    if (tab) setMapTab(tab);
    setView((current) => {
      // Se já está no mapa e pediram outra aba, troca a aba em vez de sair.
      if (current === "map") return tab ? "map" : previousViewRef.current;
      previousViewRef.current = current;
      return "map";
    });
  }, []);

  const openReview = useCallback((noteId: string) => {
    setReviewTargetId(noteId);
    setMapTab("review");
    setView((current) => {
      if (current === "map") return "map";
      previousViewRef.current = current;
      return "map";
    });
  }, []);

  const clearReviewTarget = useCallback(() => setReviewTargetId(null), []);

  const value = useMemo(
    () => ({
      view,
      mapTab,
      reviewTargetId,
      setView,
      setMapTab,
      toggleMap,
      openReview,
      clearReviewTarget
    }),
    [view, mapTab, reviewTargetId, toggleMap, openReview, clearReviewTarget]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation precisa estar dentro de <NavigationProvider>.");
  return context;
}
