/**
 * As perguntas do fluxo, uma por vez.
 *
 * Cada resposta é uma ação real sobre a nota, não um campo de formulário: é
 * isso que faz a fila andar em vez de acumular.
 */

import { useState } from "react";
import { Button, Checkbox } from "@relume_io/relume-ui";
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  Hourglass,
  Lightbulb,
  Link2,
  Network,
  Scissors,
  Sprout,
  Trash2
} from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import type { Note } from "@/domain/notes";
import { toPlainText, type NoteSection } from "@/shared/html";
import { Choice } from "./Choice";

export type Step = "triage" | "origin" | "explain" | "atomic" | "connect" | "structure";

export const STEP_ORDER: Step[] = [
  "triage",
  "origin",
  "explain",
  "atomic",
  "connect",
  "structure"
];

const STEP_QUESTION: Record<Step, string> = {
  triage: "Vale a pena processar?",
  origin: "De onde veio?",
  explain: "Consegue explicar com suas palavras?",
  atomic: "Existe mais de uma ideia aqui?",
  connect: "Onde essa ideia se conecta?",
  structure: "Faz parte de uma linha de pensamento maior?"
};

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-2xs leading-relaxed text-text-tertiary">{children}</p>;
}

export function StepPanel({
  note,
  sections,
  step,
  onStep,
  onComplete,
  onSkip,
  onOpenPicker
}: {
  note: Note;
  sections: NoteSection[];
  step: Step;
  onStep: (step: Step) => void;
  onComplete: () => void;
  onSkip: () => void;
  onOpenPicker: () => void;
}) {
  const notes = useNotes();
  const [selectedSections, setSelectedSections] = useState<Set<number>>(new Set());

  const stepNumber = STEP_ORDER.indexOf(step) + 1;

  function toggleSection(position: number) {
    setSelectedSections((previous) => {
      const next = new Set(previous);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-border-primary bg-background-primary p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
          Passo {stepNumber} de {STEP_ORDER.length}
        </span>
        {step !== "triage" ? (
          <Button
            variant="link"
            size="sm"
            className="h-6 gap-1 px-0 text-2xs text-text-secondary hover:text-text-primary"
            onClick={() => onStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)]!)}
          >
            <ChevronLeft className="size-3" strokeWidth={2} />
            Voltar
          </Button>
        ) : null}
      </div>

      <h2 className="mt-1.5 text-md font-bold leading-snug tracking-[-0.01em]">
        {STEP_QUESTION[step]}
      </h2>

      <div className="mt-3 flex flex-col gap-2">
        {step === "triage" ? (
          <>
            <Choice
              icon={ArrowRight}
              title="Sim, tem uma ideia aqui"
              hint="Continua para o processamento."
              tone="primary"
              onClick={() => onStep("origin")}
            />
            <Choice
              icon={Bookmark}
              title="Só para consulta"
              hint="Vira referência em Recursos e sai da fila."
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "reference", folder: "resources" });
                onComplete();
              }}
            />
            <Choice
              icon={Hourglass}
              title="Talvez seja útil depois"
              hint="Vai para a incubadora, sem virar dívida."
              onClick={async () => {
                await notes.patchNote(note.id, { folder: "someday" });
                onComplete();
              }}
            />
            <Choice
              icon={Trash2}
              title="Irrelevante"
              hint="Exclui a captura deste dispositivo."
              tone="danger"
              onClick={async () => {
                await notes.removeNote(note.id);
                onComplete();
              }}
            />
          </>
        ) : null}

        {step === "origin" ? (
          <>
            <Choice
              icon={BookOpen}
              title="De uma fonte externa"
              hint="Livro, aula, vídeo ou artigo. Vira nota de fonte."
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "source" });
                onStep("explain");
              }}
            />
            <Choice
              icon={Lightbulb}
              title="É uma ideia minha"
              hint="Pensamento, pergunta ou insight próprio."
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "fleeting" });
                onStep("explain");
              }}
            />
          </>
        ) : null}

        {step === "explain" ? (
          <>
            <Hint>
              Uma nota permanente exige explicar sem copiar a fonte, dizer por que importa, dar
              um exemplo e relacioná-la a outras ideias.
            </Hint>
            <Choice
              icon={Check}
              title="Sim, consigo explicar"
              hint="Segue para checar se há mais de uma ideia."
              tone="primary"
              onClick={() => onStep("atomic")}
            />
            <Choice
              icon={Sprout}
              title="Ainda não"
              hint="Fica como está para reler ou pesquisar antes."
              onClick={onSkip}
            />
          </>
        ) : null}

        {step === "atomic" ? (
          <>
            {sections.length > 1 ? (
              <>
                <Hint>
                  Esta nota tem {sections.length} seções. Marque as que defendem uma ideia
                  própria para virarem notas permanentes independentes, conectadas de volta a
                  esta.
                </Hint>
                <ul className="mb-1 flex max-h-52 flex-col gap-1 overflow-y-auto">
                  {sections.map((section, position) => (
                    <li key={`${section.title}-${position}`}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-secondary p-2 hover:bg-background-secondary">
                        <Checkbox
                          checked={selectedSections.has(position)}
                          onCheckedChange={() => toggleSection(position)}
                          aria-label={`Extrair seção ${section.title}`}
                          className="mt-0.5 size-4 rounded border-border-tertiary data-[state=checked]:border-hz-accent data-[state=checked]:bg-hz-accent"
                        />
                        <span className="min-w-0">
                          <span className="block text-2xs font-medium leading-snug">
                            {section.title}
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-2xs leading-snug text-text-secondary">
                            {toPlainText(section.html)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Choice
                  icon={Scissors}
                  title={
                    selectedSections.size
                      ? `Extrair ${selectedSections.size} ${selectedSections.size === 1 ? "ideia" : "ideias"}`
                      : "Extrair as marcadas"
                  }
                  hint="Cria notas permanentes ligadas a esta."
                  tone="primary"
                  onClick={async () => {
                    const chosen = [...selectedSections]
                      .sort((a, b) => a - b)
                      .map((position) => sections[position])
                      .filter((section): section is NoteSection => section !== undefined);
                    if (chosen.length) await notes.splitNote(note.id, chosen);
                    onStep("connect");
                  }}
                />
              </>
            ) : (
              <Hint>A nota tem uma seção só, então já defende uma ideia central.</Hint>
            )}
            <Choice
              icon={ArrowRight}
              title="É uma ideia só"
              hint="Refina e segue para as conexões."
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "permanent", folder: "resources" });
                onStep("connect");
              }}
            />
          </>
        ) : null}

        {step === "connect" ? (
          <>
            <Hint>
              Registre o motivo de cada conexão. É o que transforma links em raciocínio, em vez
              de só referências.
            </Hint>
            <Choice
              icon={Link2}
              title={
                note.connections.length
                  ? `${note.connections.length} ${note.connections.length === 1 ? "conexão" : "conexões"} — revisar`
                  : "Conectar a outras notas"
              }
              hint="Abre o seletor com o campo de motivo."
              tone="primary"
              onClick={() => {
                void notes.openNote(note.id);
                onOpenPicker();
              }}
            />
            <Choice
              icon={ArrowRight}
              title="Seguir"
              hint="Vai para a pergunta da estrutura."
              onClick={() => onStep("structure")}
            />
          </>
        ) : null}

        {step === "structure" ? (
          <>
            <Hint>
              Quando várias notas formam um assunto, uma nota de estrutura serve de mapa — ela
              não guarda o conhecimento, aponta para ele.
            </Hint>
            <Choice
              icon={Network}
              title="Sim, faz parte de um assunto"
              hint="Marca esta nota como estrutura (MOC)."
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "structure" });
                onComplete();
              }}
            />
            <Choice
              icon={Check}
              title="Não, basta ficar conectada"
              hint="Conclui o processamento desta nota."
              tone="primary"
              onClick={async () => {
                await notes.patchNote(note.id, { kind: "permanent", folder: "resources" });
                onComplete();
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
