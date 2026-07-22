/**
 * Shell de quatro painéis: navegação, coleção, editor e propriedades.
 * As três colunas da direita são redimensionáveis pelo ResizablePanelGroup
 * do Relume; a navegação usa o SidebarProvider, que também controla o colapso.
 */

import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarProvider
} from "@relume_io/relume-ui";

import { AppProviders } from "./providers/AppProviders";
import { useNotes } from "./providers/NotesProvider";
import { useNavigation } from "./providers/NavigationProvider";
import { useAnnouncer } from "./providers/AnnouncerProvider";
import { Dashboard } from "@/features/dashboard";
import { KnowledgeMap } from "@/features/knowledge";
import { NavigationRail } from "./layout/NavigationRail";
import { ProcessInbox } from "@/features/processing";
import { EditorPane, NoteList, PropertiesPanel } from "@/features/notes";
import { StatusBar } from "./layout/StatusBar";
import { WindowTitleBar } from "./layout/WindowTitleBar";
import { isTauri } from "@tauri-apps/api/core";

type AuxiliaryPane = "notes" | "properties" | null;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function Workspace() {
  const notes = useNotes();
  const navigation = useNavigation();
  const announcer = useAnnouncer();
  const compact = useMediaQuery("(max-width: 1279px)");
  const narrow = useMediaQuery("(max-width: 899px)");
  const [auxiliaryPane, setAuxiliaryPane] = useState<AuxiliaryPane>(null);
  const [notesPanelOpen, setNotesPanelOpen] = useState(true);
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(true);

  useEffect(() => {
    if (!compact) setAuxiliaryPane(null);
  }, [compact]);

  /*
   * Atalhos globais. O ⌘G mora aqui, e não no mapa: como o mapa desmonta ao
   * ser fechado, um handler interno não conseguiria reabri-lo.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;

      if (!event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void notes.newNote();
      }
      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        navigation.toggleMap();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigation, notes]);

  const compactEditor = (
    <EditorPane
      onToggleNotes={() =>
        setAuxiliaryPane((current) => (current === "notes" ? null : "notes"))
      }
      onToggleProperties={() =>
        setAuxiliaryPane((current) => (current === "properties" ? null : "properties"))
      }
      notesOpen={auxiliaryPane === "notes"}
      propertiesOpen={auxiliaryPane === "properties"}
    />
  );

  const desktopEditor = (
    <EditorPane
      onToggleNotes={() => setNotesPanelOpen((open) => !open)}
      onToggleProperties={() => setPropertiesPanelOpen((open) => !open)}
      notesOpen={notesPanelOpen}
      propertiesOpen={propertiesPanelOpen}
    />
  );

  const noteWorkspace = !compact ? (
    !notesPanelOpen && !propertiesPanelOpen ? (
      desktopEditor
    ) : (
      <ResizablePanelGroup
        key={`${notesPanelOpen}-${propertiesPanelOpen}`}
        direction="horizontal"
        autoSaveId={`hyperzettel-panes-${notesPanelOpen ? "notes" : ""}-${propertiesPanelOpen ? "properties" : ""}`}
      >
        {notesPanelOpen ? (
          <>
            <ResizablePanel id="notes" defaultSize={25} minSize={16} maxSize={40}>
              <NoteList />
            </ResizablePanel>
            <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
          </>
        ) : null}

        <ResizablePanel
          id="editor"
          defaultSize={notesPanelOpen && propertiesPanelOpen ? 50 : 75}
          minSize={30}
        >
          {desktopEditor}
        </ResizablePanel>

        {propertiesPanelOpen ? (
          <>
            <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
            <ResizablePanel id="properties" defaultSize={25} minSize={16} maxSize={40}>
              <PropertiesPanel />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    )
  ) : narrow && auxiliaryPane === "notes" ? (
    <NoteList onClose={() => setAuxiliaryPane(null)} onNoteOpened={() => setAuxiliaryPane(null)} />
  ) : narrow && auxiliaryPane === "properties" ? (
    <PropertiesPanel onClose={() => setAuxiliaryPane(null)} />
  ) : auxiliaryPane === "notes" ? (
    <ResizablePanelGroup direction="horizontal" autoSaveId="hyperzettel-compact-notes">
      <ResizablePanel defaultSize={36} minSize={28} maxSize={48}>
        <NoteList onNoteOpened={() => setAuxiliaryPane(null)} />
      </ResizablePanel>
      <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
      <ResizablePanel defaultSize={64} minSize={52}>
        {compactEditor}
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : auxiliaryPane === "properties" ? (
    <ResizablePanelGroup direction="horizontal" autoSaveId="hyperzettel-compact-properties">
      <ResizablePanel defaultSize={64} minSize={52}>
        {compactEditor}
      </ResizablePanel>
      <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
      <ResizablePanel defaultSize={36} minSize={28} maxSize={48}>
        <PropertiesPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : (
    compactEditor
  );

  return (
    <SidebarProvider
      className="h-full min-h-0 flex-col"
      /*
       * O SidebarProvider injeta seu próprio `--sidebar-width` inline, que
       * vence o valor do `:root`. A largura das colunas precisa vir daqui.
       */
      style={
        {
          "--sidebar-width": "15rem",
          "--sidebar-width-icon": "var(--navigation-rail-compact-width)"
        } as React.CSSProperties
      }
    >
      {/*
       * `min-w-0` + `overflow-hidden` são obrigatórios: sem eles o conteúdo
       * dos painéis define a largura mínima e a linha estoura o viewport.
       */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        <NavigationRail />

        {/*
          O início é uma página inteira, como no projeto original; os três
          painéis só aparecem quando há uma nota aberta.
        */}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background-primary">
          {navigation.view === "home" ? (
            <Dashboard />
          ) : navigation.view === "map" ? (
            <KnowledgeMap />
          ) : navigation.view === "process" ? (
            <ProcessInbox />
          ) : (
            noteWorkspace
          )}
        </div>
      </div>

      <StatusBar />

      {/* Região viva para leitores de tela — equivalente ao #app-announcer. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcer.message}
      </p>
    </SidebarProvider>
  );
}

export default function App() {
  const titleBarHeight = isTauri() ? "2rem" : "0rem";

  return (
    <AppProviders>
      <div
        className="flex h-full min-h-0 flex-col"
        style={
          {
            "--window-titlebar-height": titleBarHeight,
            "--navigation-rail-compact-width": "3.25rem"
          } as React.CSSProperties
        }
      >
        <WindowTitleBar />
        <div className="min-h-0 flex-1">
          <Workspace />
        </div>
      </div>
    </AppProviders>
  );
}
