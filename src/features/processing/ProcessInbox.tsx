/**
 * Fluxo de processamento da entrada.
 *
 * Percorre uma nota de cada vez pelas perguntas do método. A nota fica visível
 * o tempo todo ao lado das perguntas: decidir sem reler é chute.
 *
 * Este arquivo é a casca — a fila mora em `useProcessQueue` e as perguntas em
 * `StepPanel`.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@relume_io/relume-ui";
import { ArrowRight, Check, Layers, Pencil, X } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import { ConnectionsDialog, KindBadge } from "@/features/notes";
import { splitByHeadings, toPlainText } from "@/shared/html";
import { StepPanel, type Step } from "./StepPanel";
import { useProcessQueue } from "./useProcessQueue";

function EmptyState({ processed, onLeave }: { processed: number; onLeave: () => void }) {
  return (
    <section className="flex h-full min-w-0 flex-1 items-center justify-center bg-background-secondary p-10">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#e8f4ec] text-[#1c6b45]">
          <Check className="size-6" strokeWidth={2} />
        </span>
        <h2 className="mt-4 text-lg font-bold tracking-[-0.01em]">Entrada processada</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
          {processed
            ? `${processed} ${processed === 1 ? "nota passou" : "notas passaram"} pelo fluxo. Nada cru esperando.`
            : "Nenhuma nota crua esperando. Capturas novas aparecem aqui."}
        </p>
        <Button
          size="sm"
          className="mt-4 border-text-primary bg-text-primary text-xs text-background-primary"
          onClick={onLeave}
        >
          Voltar ao início
        </Button>
      </div>
    </section>
  );
}

export function ProcessInbox() {
  const notes = useNotes();
  const navigation = useNavigation();
  const { note, activeId, queueLength, processed, complete, skip } = useProcessQueue();

  const [step, setStep] = useState<Step>("triage");
  const [pickerOpen, setPickerOpen] = useState(false);

  const sections = useMemo(() => (note ? splitByHeadings(note.content) : []), [note]);
  const words = useMemo(
    () => (note ? toPlainText(note.content).split(/\s+/).filter(Boolean).length : 0),
    [note]
  );

  // Toda nota nova recomeça o fluxo do topo.
  useEffect(() => setStep("triage"), [activeId]);

  if (!note) {
    return <EmptyState processed={processed} onLeave={() => navigation.setView("home")} />;
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-background-secondary">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-primary bg-background-primary px-4">
        <Layers className="size-3.5 text-text-secondary" strokeWidth={1.75} />
        <h2 className="text-[13px] font-semibold">Processar entrada</h2>
        <span className="text-2xs text-text-secondary">
          {queueLength} {queueLength === 1 ? "nota crua" : "notas cruas"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="link"
            size="sm"
            className="h-7 gap-1 px-1.5 text-2xs text-text-secondary hover:text-text-primary"
            onClick={skip}
          >
            Pular
            <ArrowRight className="size-3" strokeWidth={2} />
          </Button>
          <Button
            variant="link"
            size="sm"
            aria-label="Sair do fluxo"
            className="size-7 p-0 text-text-secondary hover:text-text-primary"
            onClick={() => navigation.setView("home")}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </div>
      </header>

      <div className="hz-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[62rem] gap-5 px-8 py-6 lg:grid-cols-[1fr_23rem]">
          <article className="min-w-0 rounded-xl border border-border-primary bg-background-primary p-5 shadow-panel">
            <div className="flex items-center gap-2">
              <KindBadge kind={note.kind} size="xs" />
              <span className="text-2xs text-text-secondary">{words} palavras</span>
              <Button
                variant="link"
                size="sm"
                className="ml-auto h-6 gap-1 px-0 text-2xs text-text-secondary hover:text-hz-accent"
                onClick={() => void notes.openNote(note.id)}
              >
                <Pencil className="size-3" strokeWidth={2} />
                Editar
              </Button>
            </div>

            <h1 className="mt-2 text-xl font-bold leading-snug tracking-[-0.01em]">
              {note.title || "Sem título"}
            </h1>

            <div
              className="hz-prose mt-4 max-h-[26rem] overflow-y-auto text-[13px]"
              // O conteúdo já passou pela allowlist de sanitização ao ser salvo.
              dangerouslySetInnerHTML={{ __html: note.content }}
            />
          </article>

          <aside className="min-w-0">
            <StepPanel
              note={note}
              sections={sections}
              step={step}
              onStep={setStep}
              onComplete={complete}
              onSkip={skip}
              onOpenPicker={() => setPickerOpen(true)}
            />

            <p className="mt-3 px-1 text-2xs leading-relaxed text-text-secondary">
              A saída do sistema não é uma nota organizada, e sim uma linha de pensamento
              formada pelas conexões.
            </p>
          </aside>
        </div>
      </div>

      <ConnectionsDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) void notes.persistDraft();
        }}
      />
    </section>
  );
}
