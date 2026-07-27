/**
 * Painel do editor: cabeçalho com ações, título, barra de formatação e a
 * área de conteúdo rico. Porte de `scripts/ui/editor-controller.js`.
 *
 * O contentEditable é deliberadamente não controlado pelo React: o DOM só é
 * repopulado quando `loadToken` muda (ou seja, quando outra nota é aberta).
 * Cada digitação apenas serializa o HTML de volta para o store.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator,
  TooltipProvider
} from "@relume_io/relume-ui";
import {
  BrainCircuit,
  CircleCheck,
  FileDown,
  FileUp,
  Network,
  PanelLeft,
  PanelRight,
  Trash2
} from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useBackup } from "@/app/useBackup";
import { FormattingToolbar } from "./FormattingToolbar";
import { IconAction } from "./IconAction";
import { optimizeImageToDataUrl } from "@/infrastructure/imageOptimizer";
import { formatShortcut } from "@/shared/platform";
import { slugify } from "@/shared/slug";
import { KindBadge } from "./KindBadge";
import { FirstCycleCoach } from "@/features/onboarding/FirstCycleCoach";
import { StructureConnections } from "@/features/onboarding/StructureConnections";
import { resolveCompletionAction } from "../noteUiState";

export function EditorPane({
  onToggleNotes,
  onToggleProperties,
  notesOpen = false,
  propertiesOpen = false
}: {
  onToggleNotes?: () => void;
  onToggleProperties?: () => void;
  notesOpen?: boolean;
  propertiesOpen?: boolean;
} = {}) {
  const notes = useNotes();
  const knowledge = useKnowledge();
  const navigation = useNavigation();
  const announcer = useAnnouncer();
  const backup = useBackup();
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateEmptyState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const hasText = Boolean(editor.textContent?.trim());
    const hasMedia = Boolean(editor.querySelector("img, figure"));
    editor.classList.toggle("is-empty", !hasText && !hasMedia);
  }, []);

  /** Serializa o corpo direto: as imagens já são data-URI base64 embutidas. */
  const serialize = useCallback(() => editorRef.current?.innerHTML.trim() ?? "", []);

  // Repopula o DOM apenas quando outra nota é carregada. As imagens já vêm
  // embutidas como data-URI no HTML, então não há reidratação.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = notes.draft.content || "";
    updateEmptyState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.loadToken]);

  /**
   * Move o cursor para o início do corpo. `focus()` sozinho não basta num
   * contentEditable: sem um Range aplicado à seleção o caret não é colocado
   * e a digitação continua no campo anterior.
   */
  const focusEditorStart = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  // O textarea do título cresce conforme as linhas ocupadas.
  useEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  }, [notes.draft.title]);

  const handleInput = useCallback(() => {
    updateEmptyState();
    notes.setContent(serialize());
  }, [notes, serialize, updateEmptyState]);

  const runCommand = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      handleInput();
    },
    [handleInput]
  );

  const insertLink = useCallback(() => {
    const raw = window.prompt("Cole ou digite o endereço do link:", "https://")?.trim();
    if (!raw) return;
    const url = /^(https?:|mailto:|tel:|#)/i.test(raw) ? raw : `https://${raw}`;
    runCommand("createLink", url);
    announcer.announce("Link adicionado.");
  }, [announcer, runCommand]);

  const addImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const editor = editorRef.current;
      if (!editor) return;

      try {
        // Otimiza para WebP e embute como data-URI base64: a nota fica
        // auto-contida em um único arquivo `.html`.
        const { dataUrl } = await optimizeImageToDataUrl(file);
        const label = file.name || "Imagem da nota";

        const figure = document.createElement("figure");
        figure.contentEditable = "false";
        const image = document.createElement("img");
        image.src = dataUrl;
        image.alt = label;
        const caption = document.createElement("figcaption");
        caption.textContent = label;
        figure.append(image, caption);

        editor.focus();
        const selection = window.getSelection();
        const range =
          selection && selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
        if (!editor.contains(range.commonAncestorContainer)) {
          range.selectNodeContents(editor);
          range.collapse(false);
        }
        range.deleteContents();
        range.insertNode(figure);
        range.setStartAfter(figure);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);

        handleInput();
        announcer.announce("Imagem adicionada à nota.");
      } catch (error) {
        console.error(error);
        // O otimizador lança mensagens específicas (tipo/tamanho); mostra-as.
        announcer.announce(
          error instanceof Error ? error.message : "Não foi possível adicionar a imagem."
        );
      }
    },
    [announcer, handleInput]
  );

  // Ctrl/Cmd + S conclui o rascunho ou aplica imediatamente uma alteração.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void notes.saveNow();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [notes]);

  const slug = slugify(notes.draft.title);
  const completionAction = resolveCompletionAction({
    dirty: notes.dirty,
    status: notes.draft.status,
    hasPersistedNote: notes.currentNote !== null,
    shortcut: formatShortcut("S")
  });

  return (
    <TooltipProvider delayDuration={400}>
      <section className="flex h-full min-w-0 flex-col bg-background-primary">
        <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border-primary px-3 py-1">
          {onToggleNotes ? (
            <IconAction
              icon={PanelLeft}
              label={notesOpen ? "Recolher lista de notas" : "Abrir lista de notas"}
              onClick={onToggleNotes}
              active={notesOpen}
            />
          ) : null}
          <KindBadge kind={notes.draft.kind} size="xs" />
          <span className="truncate font-mono text-2xs text-text-secondary">{slug}</span>

          <div className="ml-auto flex items-center gap-0.5">
            <IconAction
              icon={CircleCheck}
              label={completionAction.label}
              onClick={() => void notes.saveNow()}
              disabled={notes.saving || !completionAction.enabled}
              statusDot={notes.draft.status === "draft" ? "draft" : undefined}
            />
            <IconAction
              icon={BrainCircuit}
              label={
                notes.draft.kind === "fleeting"
                  ? "Processe a captura antes de revisar"
                  : knowledge.activeRetention
                    ? `Abrir revisão ativa · retenção ${Math.round(knowledge.activeRetention.strength * 100)}%`
                    : "Conclua a nota antes de revisar"
              }
              onClick={() => navigation.toggleMap("review")}
              disabled={!knowledge.activeRetention || notes.draft.kind === "fleeting"}
            />
            <IconAction
              icon={Network}
              label={`Mapa de conhecimento (${formatShortcut("G")})`}
              onClick={() => navigation.toggleMap()}
            />
            {onToggleProperties ? (
              <IconAction
                icon={PanelRight}
                label={propertiesOpen ? "Recolher propriedades" : "Abrir propriedades"}
                onClick={onToggleProperties}
                active={propertiesOpen}
              />
            ) : null}
            <Separator orientation="vertical" className="mx-1 h-4 bg-border-primary" />
            <IconAction
              icon={FileUp}
              label="Importar backup JSON"
              onClick={() => importInputRef.current?.click()}
            />
            <IconAction
              icon={FileDown}
              label="Exportar backup JSON"
              onClick={() => void backup.exportNotes()}
            />
            <Separator orientation="vertical" className="mx-1 h-4 bg-border-primary" />
            <IconAction
              icon={Trash2}
              label="Excluir nota"
              onClick={() => setConfirmDelete(true)}
              tone="danger"
            />
          </div>
        </header>

        <FirstCycleCoach />

        <div className="hz-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[46rem] px-6 pb-24 pt-8 sm:px-10 sm:pt-9">
            {/* Textarea, e não input: títulos longos precisam quebrar linha. */}
            <textarea
              ref={titleRef}
              value={notes.draft.title}
              onChange={(event) => notes.setTitle(event.target.value)}
              onKeyDown={(event) => {
                // Enter salta para o corpo em vez de inserir quebra no título.
                if (event.key !== "Enter") return;
                event.preventDefault();
                focusEditorStart();
              }}
              rows={1}
              placeholder="Novo Zettel"
              aria-label="Título da nota"
              className="w-full resize-none overflow-hidden border-0 bg-transparent text-[2rem] font-bold leading-[1.2] tracking-[-0.02em] outline-none placeholder:text-neutral-lighter"
            />

            <Separator className="my-5 bg-border-primary" />

            <FormattingToolbar
              onCommand={runCommand}
              onInsertLink={insertLink}
              onInsertImage={() => imageInputRef.current?.click()}
            />

            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Conteúdo da nota"
              data-placeholder="Comece a escrever. Conecte esta nota a outras pelo painel à direita."
              onInput={handleInput}
              onPaste={(event) => {
                // Cola sempre como texto puro, evitando HTML externo no conteúdo.
                event.preventDefault();
                document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
              }}
              className="hz-prose min-h-[24rem] pb-10"
            />

            <StructureConnections />
          </div>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void addImage(file);
          }}
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void backup.importNotes(file);
          }}
        />

        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent className="max-w-sm rounded-lg border border-border-primary bg-background-primary p-6 shadow-pop">
            <DialogHeader>
              <DialogTitle className="text-md">Excluir esta nota?</DialogTitle>
              <DialogDescription className="text-xs text-text-tertiary">
                A nota sai deste dispositivo e a ação não pode ser desfeita. As conexões
                feitas por outras notas deixam de apontar para ela.
              </DialogDescription>
            </DialogHeader>
            {/* Sem `DialogClose asChild`: o Button do Relume não expõe um
                único nó, e o Slot do Radix quebra ao clonar. O fechamento
                usa o estado que este componente já controla. */}
            <DialogFooter className="gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={() => setConfirmDelete(false)}
              >
                Continuar editando
              </Button>
              <Button
                size="sm"
                className="border-system-error-red bg-system-error-red text-xs text-white"
                onClick={() => {
                  setConfirmDelete(false);
                  void notes.deleteActiveNote();
                }}
              >
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </TooltipProvider>
  );
}
