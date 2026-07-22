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
  setView: (view: WorkspaceView) => void;
  setMapTab: (tab: MapTab) => void;
  /** Abre o mapa, ou volta para a tela anterior se ele já estiver aberto. */
  toggleMap: (tab?: MapTab) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<WorkspaceView>("home");
  const [mapTab, setMapTab] = useState<MapTab>("explore");
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

  const value = useMemo(
    () => ({ view, mapTab, setView, setMapTab, toggleMap }),
    [view, mapTab, toggleMap]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation precisa estar dentro de <NavigationProvider>.");
  return context;
}
