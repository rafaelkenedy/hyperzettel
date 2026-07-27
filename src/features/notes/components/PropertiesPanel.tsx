/**
 * Coluna de propriedades: metadados editáveis, relações e informações
 * derivadas da nota ativa. Ocupa o lugar do painel de conexões do original,
 * agora sempre visível ao lado do editor.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  cn
} from "@relume_io/relume-ui";
import {
  Brain,
  ChevronDown,
  Folder,
  Hash,
  History,
  Info,
  Link2,
  PanelRightClose,
  Plus,
  SlidersHorizontal,
  Sprout,
  Undo2
} from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import {
  FOLDER_LABELS,
  KIND_HINTS,
  KIND_LABELS,
  TEMPLATE_LABELS,
  type FolderId,
  type NoteKind,
  type TemplateId
} from "@/domain/notes";
import { countWords, formatFullDate, formatRelative } from "@/shared/html";
import { formatShortcut } from "@/shared/platform";
import { ConnectionsDialog } from "./ConnectionsDialog";
import {
  LEVEL_TONE,
  RelatedNotes,
  RelationSettings,
  RelationStatus,
  dueLabel,
  useKnowledgeRelations
} from "@/features/knowledge";
import { RelationRow } from "./RelationRow";
import { KIND_TONE_CLASSES } from "../kindTones";
import { NOTE_UI_LABELS, resolveNoteUiState } from "../noteUiState";

function Row({
  icon: Icon,
  label,
  children
}: {
  icon: typeof Hash;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-4 py-1">
      <span className="flex w-[5.5rem] shrink-0 items-center gap-1.5 text-xs text-text-secondary">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-4 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-[0.07em] text-text-secondary">
      {children}
    </p>
  );
}

function CollapsibleSection({
  icon: Icon,
  label,
  children,
  defaultOpen = false
}: {
  icon: typeof Info;
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-1.5 px-4 text-left text-xs font-semibold uppercase tracking-[0.07em] text-text-secondary hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hz-accent"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="size-3.5" strokeWidth={1.8} />
        <span className="flex-1">{label}</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="pb-2">{children}</div> : null}
    </section>
  );
}

type PanelFeedback = {
  message: string;
  undo?: () => void | Promise<void>;
};

export function PropertiesPanel({ onClose }: { onClose?: () => void } = {}) {
  const notes = useNotes();
  const knowledge = useKnowledge();
  const navigation = useNavigation();
  const semanticRelations = useKnowledgeRelations();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focusConnectionId, setFocusConnectionId] = useState<string | null>(null);
  const [showAllConnections, setShowAllConnections] = useState(false);
  const [feedback, setFeedback] = useState<PanelFeedback | null>(null);

  // Ctrl/Cmd + Shift + K abre o seletor de conexões.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPickerOpen(true);
      }
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 6000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    setShowAllConnections(false);
    setFocusConnectionId(null);
    setFeedback(null);
  }, [notes.draft.id]);

  // Atividade recente do workspace — ocupa o lugar do histórico do layout.
  const recent = useMemo(
    () =>
      notes.notes
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 3),
    [notes.notes]
  );

  const words = countWords(notes.draft.content);
  const visibleRelations = showAllConnections ? notes.relations : notes.relations.slice(0, 3);
  const noteUiState = resolveNoteUiState({
    saving: notes.saving,
    dirty: notes.dirty,
    status: notes.draft.status,
    hasPersistedNote: notes.currentNote !== null
  });

  return (
    <aside className="relative flex h-full flex-col border-l border-border-primary bg-background-primary">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-primary px-4">
        <SlidersHorizontal className="size-3.5 text-text-secondary" strokeWidth={1.75} />
        <h2 className="flex-1 text-[13px] font-semibold">Propriedades</h2>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-2xs font-medium",
            noteUiState === "autosave-pending" || noteUiState === "updating"
              ? "bg-[#fdf1dd] text-[#7a4d0d]"
              : "bg-background-tertiary text-text-secondary"
          )}
        >
          {NOTE_UI_LABELS[noteUiState]}
        </span>
        {onClose ? (
          <Button
            variant="link"
            size="sm"
            className="size-8 shrink-0 p-0 text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-hz-accent"
            aria-label="Recolher propriedades"
            title="Recolher propriedades"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" strokeWidth={1.75} />
          </Button>
        ) : null}
      </header>

      <div className="hz-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="pt-2">
          {/* O tipo epistêmico vem primeiro: é ele que diz em que estágio
              do ciclo a ideia está. O modelo é só a estrutura do documento. */}
          <Row icon={Sprout} label="Estágio">
            <Select
              value={notes.draft.kind}
              onValueChange={(value) => notes.setKind(value as NoteKind)}
            >
              <SelectTrigger
                aria-label="Estágio da nota"
                className={cn(
                  "h-8 w-full justify-between rounded-md border-0 px-2 text-xs font-medium ring-1 ring-inset hover:brightness-[0.98] focus:ring-2 focus:ring-hz-accent focus:ring-offset-1",
                  KIND_TONE_CLASSES[notes.draft.kind]
                )}
              >
                <SelectValue>{KIND_LABELS[notes.draft.kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent className="text-xs">
                {(Object.keys(KIND_LABELS) as NoteKind[]).map((kind) => (
                  <SelectItem key={kind} value={kind} className="text-xs">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 rounded-full ring-1 ring-inset",
                          KIND_TONE_CLASSES[kind]
                        )}
                      />
                      {KIND_LABELS[kind]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <p className="mb-1 pl-[7.5rem] pr-4 text-2xs leading-snug text-text-secondary">
            {KIND_HINTS[notes.draft.kind]}
          </p>

          <Row icon={Hash} label="Modelo">
            <Select
              value={notes.draft.template}
              onValueChange={(value) => notes.setTemplate(value as TemplateId)}
            >
              <SelectTrigger
                aria-label="Modelo da nota"
                className="h-8 w-full justify-between rounded-md border-0 bg-background-tertiary px-2 text-xs hover:bg-hz-hover focus:ring-2 focus:ring-hz-accent focus:ring-offset-1"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                {(Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((template) => (
                  <SelectItem key={template} value={template} className="text-xs">
                    {TEMPLATE_LABELS[template]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row icon={Folder} label="Pasta">
            <Select
              value={notes.draft.folder}
              onValueChange={(value) => notes.setFolder(value as FolderId)}
            >
              <SelectTrigger
                aria-label="Pasta da nota"
                className="h-8 w-full justify-between rounded-md border-0 bg-background-tertiary px-2 text-xs hover:bg-hz-hover focus:ring-2 focus:ring-hz-accent focus:ring-offset-1"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="text-xs">
                {(Object.keys(FOLDER_LABELS) as FolderId[]).map((folder) => (
                  <SelectItem key={folder} value={folder} className="text-xs">
                    {FOLDER_LABELS[folder]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

        </div>

        <Separator className="my-2 bg-border-secondary" />

        {/*
          Um bloco só: conexão é aresta sem direção, e separar saída de entrada
          fazia a mesma nota aparecer duas vezes em 49 das 57 notas.
        */}
        <SectionLabel>{`Conexões · ${notes.relations.length}`}</SectionLabel>
        <div className="flex flex-col gap-1 px-4">
          {notes.relations.length === 0 ? (
            <p className="py-1 text-xs text-text-secondary">
              Nenhuma conexão ainda. Uma ideia isolada não vira linha de pensamento.
            </p>
          ) : (
            visibleRelations.map((relation) => (
              <RelationRow
                key={relation.note.id}
                relation={relation}
                onOpen={() => void notes.openNote(relation.note.id)}
                onReason={(value) => {
                  // Escrever o porquê de uma relação só recebida cria a volta.
                  if (relation.direction === "incoming") notes.toggleConnection(relation.note.id);
                  notes.setConnectionReason(relation.note.id, value);
                }}
                onRemove={() => notes.removeConnection(relation.note.id)}
                autoFocusReason={focusConnectionId === relation.note.id}
              />
            ))
          )}
          {notes.relations.length > 3 ? (
            <Button
              variant="link"
              size="sm"
              className="h-8 justify-start px-1 text-xs text-text-secondary hover:text-hz-accent focus-visible:ring-2 focus-visible:ring-hz-accent"
              onClick={() => setShowAllConnections((value) => !value)}
            >
              {showAllConnections
                ? "Mostrar menos"
                : `Mostrar mais ${notes.relations.length - 3}`}
            </Button>
          ) : null}
          <Button
            variant="link"
            size="sm"
            onClick={() => setPickerOpen(true)}
            className="mt-1 h-8 justify-start gap-1.5 px-1 text-xs text-text-secondary hover:text-hz-accent focus-visible:ring-2 focus-visible:ring-hz-accent"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            Adicionar conexão
            <span className="ml-1 text-2xs opacity-60">{formatShortcut("Shift+K")}</span>
          </Button>
        </div>

        <Separator className="my-3 bg-border-secondary" />

        <SectionLabel>
          {`Sugestões de conexão · ${semanticRelations.related.length}`}
        </SectionLabel>
        <div className="px-4">
          <RelationStatus />
          <div className="mt-2">
            <RelatedNotes
              onConnected={(note) => {
                setFocusConnectionId(note.id);
                setShowAllConnections(true);
                setFeedback({
                  message: `Conexão criada com “${note.title || "Sem título"}”.`,
                  undo: () => {
                    notes.removeConnection(note.id);
                    setFocusConnectionId(null);
                  }
                });
              }}
              onRejected={(note, restore) => {
                setFeedback({
                  message: `Sugestão “${note.title || "Sem título"}” ocultada.`,
                  undo: restore
                });
              }}
            />
          </div>
          <RelationSettings />
        </div>

        <Separator className="my-3 bg-border-secondary" />

        <CollapsibleSection icon={Brain} label="Aprendizagem">
          <div className="px-4 pt-1">
            {!knowledge.activeRetention ? (
              <p className="py-1 text-xs text-text-secondary">
                Conclua a nota para acompanhar a retenção.
              </p>
            ) : notes.draft.kind === "fleeting" ? (
              // Nota fugaz ainda não foi destilada; revisar só faz sentido depois
              // que ela vira permanente. Evita oferecer uma ação fora do estágio.
              <p className="py-1 text-xs text-text-secondary">
                A revisão espaçada começa quando a nota deixa de ser fugaz — processe-a
                para uma nota permanente primeiro.
              </p>
            ) : (
              <>
                {knowledge.activeRetention.reviewCount ? (
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-2xs font-semibold tabular-nums", LEVEL_TONE[knowledge.activeRetention.level])}>
                      {Math.round(knowledge.activeRetention.strength * 100)}%
                    </span>
                    <span className="text-xs text-text-tertiary">
                      {knowledge.activeRetention.reviewCount}{" "}
                      {knowledge.activeRetention.reviewCount === 1 ? "revisão" : "revisões"} ·{" "}
                      {dueLabel(knowledge.activeRetention.dueAt).replace(/\.$/, "")}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-text-tertiary">Nunca revisada.</p>
                )}
                <p className="mt-2 text-2xs leading-relaxed text-text-secondary">
                  A avaliação aparece somente depois que você tenta lembrar e revela a
                  nota.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 h-8 border-border-primary bg-background-secondary px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-hz-accent"
                  onClick={() => navigation.toggleMap("review")}
                >
                  Abrir revisão sem olhar
                </Button>
              </>
            )}
          </div>
        </CollapsibleSection>

        <Separator className="my-3 bg-border-secondary" />

        <CollapsibleSection icon={Info} label="Informações">
          <dl className="px-4 text-xs">
            {[
              ["Modificada", formatRelative(notes.draft.updatedAt)],
              ["Criada", formatFullDate(notes.draft.createdAt)],
              ["Palavras", String(words)],
              ["Conexões", String(notes.connectionCounts.get(notes.draft.id) ?? 0)]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-1">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="tabular-nums text-text-tertiary">{value}</dd>
              </div>
            ))}
          </dl>
        </CollapsibleSection>

        <Separator className="my-3 bg-border-secondary" />

        <CollapsibleSection icon={History} label="Notas recentes">
          <ul className="px-4">
            {recent.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => void notes.openNote(note.id)}
                  className="w-full rounded-md px-1 py-1.5 text-left hover:bg-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent"
                >
                  <span className="flex items-center gap-1.5">
                    <Link2 className="size-3 shrink-0 text-text-secondary" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-xs text-link-primary">
                      {note.title || "Sem título"}
                    </span>
                  </span>
                  <span className="ml-[18px] block text-2xs text-text-secondary">
                    {formatRelative(note.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      </div>

      {feedback ? (
        <div
          className="absolute bottom-3 left-3 right-3 z-20 flex items-center gap-2 rounded-lg border border-border-tertiary bg-background-primary p-2.5 text-xs text-text-primary shadow-pop"
          role="status"
          aria-live="polite"
        >
          <span className="min-w-0 flex-1 leading-snug">{feedback.message}</span>
          {feedback.undo ? (
            <button
              type="button"
              className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 font-semibold text-hz-accent hover:bg-hz-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent"
              onClick={() => {
                const undo = feedback.undo;
                setFeedback({ message: "Ação desfeita." });
                void undo?.();
              }}
            >
              <Undo2 className="size-3.5" />
              Desfazer
            </button>
          ) : null}
        </div>
      ) : null}

      <ConnectionsDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </aside>
  );
}
