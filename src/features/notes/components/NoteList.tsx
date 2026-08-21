/**
 * Painel central: cabeçalho da coleção, busca e cartões de nota.
 * O cartão ativo recebe a barra e o fundo verdes, como no layout de referência.
 */

import { useEffect, useRef } from "react";
import { Button, Input, cn } from "@relume_io/relume-ui";
import { Folder, Link2, PanelLeftClose, Plus, Search, X } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import {
  FOLDER_LABELS,
  matchesScope,
  scopeLabel,
  type Note
} from "@/domain/notes";
import { formatRelative, toPlainText } from "@/shared/html";
import { formatShortcut } from "@/shared/platform";
import { KindBadge } from "./KindBadge";

function NoteCard({
  note,
  isActive,
  isDirty,
  connections,
  onOpen,
  cardRef
}: {
  note: Note;
  isActive: boolean;
  isDirty: boolean;
  connections: number;
  onOpen: () => void;
  cardRef?: React.Ref<HTMLElement>;
}) {
  const contentText = toPlainText(note.content);
  const excerpt =
    contentText.localeCompare(note.title.trim(), "pt-BR", { sensitivity: "base" }) === 0
      ? ""
      : contentText;
  const statusLabel = isActive && isDirty
    ? "Autosave pendente"
    : note.status === "draft"
      ? "Rascunho"
      : null;

  return (
    <article
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-current={isActive ? "page" : undefined}
      aria-label={`Abrir nota: ${note.title || "Sem título"}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
      className={cn(
        "relative cursor-pointer border-b border-border-secondary px-4 py-2.5 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent",
        isActive ? "bg-hz-active" : "hover:bg-background-secondary"
      )}
    >
      {isActive ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-hz-active-bar"
        />
      ) : null}

      <div className="flex items-start gap-2">
        <h3 className="line-clamp-2 min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug tracking-[-0.005em]">
          {note.title || "Sem título"}
        </h3>
      </div>

      {excerpt ? (
        <p className="mt-0.5 line-clamp-2 break-words text-xs leading-[1.45] text-text-tertiary">
          {excerpt}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <KindBadge kind={note.kind} />
        <span
          className="inline-flex items-center gap-1 text-xs text-text-secondary"
          title={`Pasta: ${FOLDER_LABELS[note.folder]}`}
        >
          <Folder className="size-3" strokeWidth={1.75} aria-hidden="true" />
          {FOLDER_LABELS[note.folder]}
        </span>
        {connections > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-text-secondary"
            aria-label={`${connections} ${connections === 1 ? "conexão" : "conexões"}`}
            title={`${connections} ${connections === 1 ? "conexão" : "conexões"}`}
          >
            <Link2 className="size-3" strokeWidth={1.75} aria-hidden="true" />
            {connections}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-text-secondary">
        <span>{formatRelative(note.updatedAt)}</span>
        {statusLabel ? (
          <span className="text-right font-medium text-hz-draft">{statusLabel}</span>
        ) : null}
      </div>
    </article>
  );
}

export function NoteList({
  onClose,
  onNoteOpened
}: {
  onClose?: () => void;
  onNoteOpened?: () => void;
} = {}) {
  const notes = useNotes();
  const searchRef = useRef<HTMLInputElement>(null);
  const activeCardRef = useRef<HTMLElement>(null);
  const searchShortcut = formatShortcut("K");
  const newNoteShortcut = formatShortcut("N");
  const scopedTotal = notes.notes.filter((note) => matchesScope(note, notes.scope)).length;

  // Ctrl/Cmd + K foca a busca, como no Hyperzettel original.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Mantém a nota aberta visível quando ela muda por busca, mapa ou atividade recente.
  useEffect(() => {
    activeCardRef.current?.scrollIntoView({ block: "nearest" });
  }, [notes.draft.id, notes.query, notes.scope]);

  return (
    <section className="flex h-full flex-col border-r border-border-primary bg-background-primary">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border-primary pl-4 pr-2">
        <h2 className="flex-1 truncate text-[13px] font-semibold">{scopeLabel(notes.scope)}</h2>

        {/* Texto passivo: a ordenação é fixa e não deve parecer um menu. */}
        <span
          className="px-1.5 text-xs text-text-secondary"
          title="Mais recentes primeiro"
        >
          Recentes
        </span>

        <Button
          variant="link"
          size="sm"
          className="size-8 shrink-0 rounded-md bg-background-secondary p-0 text-text-primary hover:bg-hz-hover focus-visible:ring-2 focus-visible:ring-hz-accent"
          aria-label={`Nova nota (${newNoteShortcut})`}
          title={`Nova nota (${newNoteShortcut})`}
          onClick={() => void notes.newNote()}
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </Button>
        {onClose ? (
          <Button
            variant="link"
            size="sm"
            className="size-8 shrink-0 p-0 text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-hz-accent"
            aria-label="Recolher lista de notas"
            title="Recolher lista de notas"
            onClick={onClose}
          >
            <PanelLeftClose className="size-4" strokeWidth={1.75} />
          </Button>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border-primary px-3 py-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary"
            strokeWidth={1.75}
          />
          <Input
            ref={searchRef}
            value={notes.query}
            onChange={(event) => notes.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              if (notes.query) notes.setQuery("");
              else event.currentTarget.blur();
            }}
            placeholder={`Buscar notas…  ${searchShortcut}`}
            aria-label="Buscar notas"
            className="h-8 rounded-md border-border-primary bg-background-secondary pl-8 pr-8 text-xs placeholder:text-text-secondary focus:border-hz-accent focus:bg-background-primary"
          />
          {notes.query ? (
            <Button
              variant="link"
              size="sm"
              className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 rounded-md p-0 text-text-secondary hover:bg-hz-hover hover:text-text-primary"
              aria-label="Limpar busca"
              title="Limpar busca (Esc)"
              onClick={() => {
                notes.setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="hz-scroll min-h-0 flex-1 overflow-y-auto">
        {notes.visibleNotes.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] font-semibold">Nenhuma nota encontrada</p>
            <p className="mt-1 text-xs text-text-secondary">
              Ajuste a busca ou escolha outra coleção.
            </p>
          </div>
        ) : (
          notes.visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              isActive={note.id === notes.draft.id}
              isDirty={notes.dirty}
              connections={notes.connectionCounts.get(note.id) ?? 0}
              cardRef={note.id === notes.draft.id ? activeCardRef : undefined}
              onOpen={() => {
                void notes.openNote(note.id);
                onNoteOpened?.();
              }}
            />
          ))
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center border-t border-border-primary px-4 text-xs text-text-secondary">
        <span>
          {notes.query ? `${notes.visibleNotes.length} de ${scopedTotal}` : scopedTotal}{" "}
          {scopedTotal === 1 ? "nota" : "notas"}
        </span>
      </footer>
    </section>
  );
}
