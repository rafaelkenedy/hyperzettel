/**
 * Composição dos providers.
 *
 * A ordem expressa a direção das dependências: aviso e navegação não dependem
 * de ninguém, notas dependem dos dois, e conhecimento depende de notas.
 */

import { useMemo, type ReactNode } from "react";

import { AnnouncerProvider } from "@/app/providers/AnnouncerProvider";
import { KnowledgeProvider } from "@/app/providers/KnowledgeProvider";
import { NavigationProvider } from "@/app/providers/NavigationProvider";
import { NotesProvider } from "@/app/providers/NotesProvider";
import { useNotes } from "@/app/providers/NotesProvider";
import { KnowledgeRelationsProvider } from "@/features/knowledge";

function KnowledgeLayers({ children }: { children: ReactNode }) {
  const notes = useNotes();
  const connectedNoteIdsKey = notes.relations
    .map((relation) => relation.note.id)
    .sort()
    .join("\u0000");
  const connectedNoteIds = useMemo(
    () => (connectedNoteIdsKey ? connectedNoteIdsKey.split("\u0000") : []),
    [connectedNoteIdsKey]
  );
  return (
    <KnowledgeRelationsProvider
      notes={notes.savedNotes}
      activeNoteId={notes.draft.id}
      connectedNoteIds={connectedNoteIds}
      ready={notes.ready}
      onOpen={(noteId) => void notes.openNote(noteId)}
      onConnect={notes.addConnection}
    >
      <KnowledgeProvider>{children}</KnowledgeProvider>
    </KnowledgeRelationsProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AnnouncerProvider>
      <NavigationProvider>
        <NotesProvider>
          <KnowledgeLayers>{children}</KnowledgeLayers>
        </NotesProvider>
      </NavigationProvider>
    </AnnouncerProvider>
  );
}
