import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@relume_io/relume-ui";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Copy, FileDown, FileUp, Menu, Minus, Square, X } from "lucide-react";

import { useBackup } from "@/app/useBackup";

type NavigationAvailability = EventTarget & {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

function getNavigationAvailability(): NavigationAvailability | null {
  return (
    window as unknown as {
      navigation?: NavigationAvailability;
    }
  ).navigation ?? null;
}

function readHistoryAvailability() {
  const navigation = getNavigationAvailability();
  return {
    canGoBack: navigation?.canGoBack ?? window.history.length > 1,
    canGoForward: navigation?.canGoForward ?? false,
  };
}

function useHistoryAvailability() {
  const [availability, setAvailability] = useState(readHistoryAvailability);

  useEffect(() => {
    const navigation = getNavigationAvailability();
    const sync = () => setAvailability(readHistoryAvailability());

    navigation?.addEventListener("currententrychange", sync);
    window.addEventListener("popstate", sync);

    return () => {
      navigation?.removeEventListener("currententrychange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return availability;
}

function reportWindowError(action: string, error: unknown): void {
  console.error(`Não foi possível ${action} a janela.`, error);
}

/**
 * Barra de janela deliberadamente sem marca: o lado esquerdo concentra ações
 * globais e histórico; o centro continua livre para arrastar a janela.
 */
export function WindowTitleBar() {
  const runningInTauri = isTauri();
  const backup = useBackup();
  const importInputRef = useRef<HTMLInputElement>(null);
  const { canGoBack, canGoForward } = useHistoryAvailability();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!runningInTauri) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let stopListening: (() => void) | undefined;

    const syncMaximized = async () => {
      try {
        const next = await appWindow.isMaximized();
        if (!disposed) setMaximized(next);
      } catch (error) {
        reportWindowError("ler o estado de", error);
      }
    };

    void syncMaximized();
    void appWindow.onResized(() => void syncMaximized()).then((stop) => {
      if (disposed) stop();
      else stopListening = stop;
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [runningInTauri]);

  if (!runningInTauri) return null;

  const appWindow = getCurrentWindow();
  const run = (action: string, operation: () => Promise<void>) => {
    void operation().catch((error) => reportWindowError(action, error));
  };

  return (
    <header className="flex h-8 shrink-0 select-none border-b border-border-primary bg-hz-rail text-text-primary">
      <nav className="flex h-full shrink-0" aria-label="Menu e histórico">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid h-8 w-[var(--navigation-rail-compact-width)] place-items-center border-0 p-0 pl-1 text-text-secondary hover:bg-hz-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent data-[state=open]:bg-hz-hover data-[state=open]:text-text-primary"
            aria-label="Abrir menu do Hyperzettel"
            title="Menu"
          >
            {/* O recuo replica a assimetria óptica dos botões da lateral. */}
            <Menu className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={4}
            className="z-[100] min-w-60 rounded-lg border border-border-primary bg-background-primary p-1.5 shadow-pop"
          >
            <DropdownMenuLabel className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-text-secondary">
              Backup das notas
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="my-1 bg-border-primary" />
            <DropdownMenuItem
              className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-xs text-text-primary outline-none data-[highlighted]:bg-hz-hover"
              onSelect={() => importInputRef.current?.click()}
            >
              <FileUp className="size-4 text-text-secondary" strokeWidth={1.75} />
              Importar backup JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-xs text-text-primary outline-none data-[highlighted]:bg-hz-hover"
              onSelect={() => void backup.exportNotes()}
            >
              <FileDown className="size-4 text-text-secondary" strokeWidth={1.75} />
              Exportar backup JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          className="grid h-8 w-9 place-items-center text-text-secondary hover:bg-hz-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent disabled:pointer-events-none disabled:opacity-30"
          aria-label="Voltar"
          title={canGoBack ? "Voltar" : "Não há nota anterior"}
          disabled={!canGoBack}
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="grid h-8 w-9 place-items-center text-text-secondary hover:bg-hz-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent disabled:pointer-events-none disabled:opacity-30"
          aria-label="Avançar"
          title={canGoForward ? "Avançar" : "Não há nota seguinte"}
          disabled={!canGoForward}
          onClick={() => window.history.forward()}
        >
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </button>
      </nav>

      <div
        data-tauri-drag-region
        className="min-w-0 flex-1"
        aria-hidden="true"
        onDoubleClick={() => run("maximizar", () => appWindow.toggleMaximize())}
      />

      <div className="flex h-full shrink-0" aria-label="Controles da janela">
        <button
          type="button"
          className="grid h-8 w-[46px] place-items-center hover:bg-hz-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent"
          aria-label="Minimizar"
          title="Minimizar"
          onClick={() => run("minimizar", () => appWindow.minimize())}
        >
          <Minus className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="grid h-8 w-[46px] place-items-center hover:bg-hz-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent"
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          title={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => run(maximized ? "restaurar" : "maximizar", () => appWindow.toggleMaximize())}
        >
          {maximized ? (
            <Copy className="size-3.5" strokeWidth={1.5} />
          ) : (
            <Square className="size-3" strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          className="grid h-8 w-[46px] place-items-center hover:bg-[#c42b1c] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent"
          aria-label="Fechar"
          title="Fechar"
          onClick={() => run("fechar", () => appWindow.close())}
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void backup.importNotes(file);
        }}
      />
    </header>
  );
}
