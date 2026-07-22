/**
 * Região viva para leitores de tela.
 *
 * Fica isolada porque é transversal: notas, conhecimento e processamento
 * anunciam resultados, e nenhum deles deveria depender dos outros só para
 * conseguir falar com quem usa leitor de tela.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface Announcer {
  message: string;
  announce: (message: string) => void;
}

const AnnouncerContext = createContext<Announcer | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");

  const announce = useCallback((text: string) => {
    // Limpar antes força o leitor a reanunciar mensagens repetidas.
    setMessage("");
    window.setTimeout(() => setMessage(text), 20);
  }, []);

  const value = useMemo(() => ({ message, announce }), [message, announce]);

  return <AnnouncerContext.Provider value={value}>{children}</AnnouncerContext.Provider>;
}

export function useAnnouncer(): Announcer {
  const context = useContext(AnnouncerContext);
  if (!context) throw new Error("useAnnouncer precisa estar dentro de <AnnouncerProvider>.");
  return context;
}
