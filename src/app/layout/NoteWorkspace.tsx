/**
 * Layout responsivo dos três painéis de notas.
 *
 * Extraído do App.tsx para manter cada componente com uma responsabilidade
 * (o shell decide a rota, este componente decide como distribuir os painéis).
 */

import { useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@relume_io/relume-ui";

import { EditorPane, NoteList, PropertiesPanel } from "@/features/notes";

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

function DesktopPanels({
  notesPanelOpen,
  propertiesPanelOpen,
  onToggleNotes,
  onToggleProperties
}: {
  notesPanelOpen: boolean;
  propertiesPanelOpen: boolean;
  onToggleNotes: () => void;
  onToggleProperties: () => void;
}) {
  const editor = (
    <EditorPane
      onToggleNotes={onToggleNotes}
      onToggleProperties={onToggleProperties}
      notesOpen={notesPanelOpen}
      propertiesOpen={propertiesPanelOpen}
    />
  );

  if (!notesPanelOpen && !propertiesPanelOpen) return editor;

  return (
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
        {editor}
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
  );
}

function CompactPanels({
  auxiliaryPane,
  setAuxiliaryPane,
  narrow
}: {
  auxiliaryPane: AuxiliaryPane;
  setAuxiliaryPane: (pane: AuxiliaryPane) => void;
  narrow: boolean;
}) {
  const editor = (
    <EditorPane
      onToggleNotes={() =>
        setAuxiliaryPane(auxiliaryPane === "notes" ? null : "notes")
      }
      onToggleProperties={() =>
        setAuxiliaryPane(auxiliaryPane === "properties" ? null : "properties")
      }
      notesOpen={auxiliaryPane === "notes"}
      propertiesOpen={auxiliaryPane === "properties"}
    />
  );

  if (narrow && auxiliaryPane === "notes") {
    return <NoteList onClose={() => setAuxiliaryPane(null)} onNoteOpened={() => setAuxiliaryPane(null)} />;
  }
  if (narrow && auxiliaryPane === "properties") {
    return <PropertiesPanel onClose={() => setAuxiliaryPane(null)} />;
  }

  if (auxiliaryPane === "notes") {
    return (
      <ResizablePanelGroup direction="horizontal" autoSaveId="hyperzettel-compact-notes">
        <ResizablePanel defaultSize={36} minSize={28} maxSize={48}>
          <NoteList onNoteOpened={() => setAuxiliaryPane(null)} />
        </ResizablePanel>
        <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
        <ResizablePanel defaultSize={64} minSize={52}>
          {editor}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  if (auxiliaryPane === "properties") {
    return (
      <ResizablePanelGroup direction="horizontal" autoSaveId="hyperzettel-compact-properties">
        <ResizablePanel defaultSize={64} minSize={52}>
          {editor}
        </ResizablePanel>
        <ResizableHandle className="w-px bg-border-primary transition-colors hover:bg-hz-accent/40" />
        <ResizablePanel defaultSize={36} minSize={28} maxSize={48}>
          <PropertiesPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return editor;
}

export function NoteWorkspace() {
  const compact = useMediaQuery("(max-width: 1279px)");
  const narrow = useMediaQuery("(max-width: 899px)");
  const [auxiliaryPane, setAuxiliaryPane] = useState<AuxiliaryPane>(null);
  const [notesPanelOpen, setNotesPanelOpen] = useState(true);
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(true);

  useEffect(() => {
    if (!compact) setAuxiliaryPane(null);
  }, [compact]);

  if (!compact) {
    return (
      <DesktopPanels
        notesPanelOpen={notesPanelOpen}
        propertiesPanelOpen={propertiesPanelOpen}
        onToggleNotes={() => setNotesPanelOpen((open) => !open)}
        onToggleProperties={() => setPropertiesPanelOpen((open) => !open)}
      />
    );
  }

  return (
    <CompactPanels
      auxiliaryPane={auxiliaryPane}
      setAuxiliaryPane={setAuxiliaryPane}
      narrow={narrow}
    />
  );
}
