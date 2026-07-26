import { Button } from "@relume_io/relume-ui";
import { Check, Link2, ListTree, PenLine, Sparkles } from "lucide-react";

import { useNavigation } from "@/app/providers/NavigationProvider";
import { useNotes } from "@/app/providers/NotesProvider";
import { firstCycleProgressFor } from "./guidedOnboarding";

export function FirstCycleCoach() {
  const notes = useNotes();
  const navigation = useNavigation();
  const progress = firstCycleProgressFor(notes.notes, notes.draft.id);
  if (!progress) return null;

  const common =
    "flex shrink-0 items-center gap-3 border-b border-border-primary bg-[#f7f8fc] px-4 py-2.5";

  if (progress.stage === "capture") {
    return (
      <aside className={common} aria-label="Primeiro ciclo">
        <ListTree className="size-4 shrink-0 text-hz-accent" strokeWidth={1.8} />
        <p className="min-w-0 flex-1 text-xs text-text-tertiary">
          <strong className="text-text-primary">Mapa criado.</strong> Agora capture uma única
          ideia que responda a uma das perguntas.
        </p>
        <Button
          size="sm"
          className="h-7 shrink-0 gap-1.5 border-text-primary bg-text-primary px-2.5 text-2xs text-background-primary"
          onClick={() => void notes.newNote()}
        >
          <PenLine className="size-3" strokeWidth={2} />
          Criar primeira captura
        </Button>
      </aside>
    );
  }

  if (progress.stage === "write") {
    return (
      <aside className={common} aria-label="Primeiro ciclo">
        <PenLine className="size-4 shrink-0 text-hz-accent" strokeWidth={1.8} />
        <p className="text-xs text-text-tertiary">
          <strong className="text-text-primary">
            Ideia {progress.connectedCount + 1} de {progress.targetCount}.
          </strong>{" "}
          Dê um título, explique com suas palavras e conclua a nota.
        </p>
      </aside>
    );
  }

  if (progress.stage === "expand") {
    return (
      <aside className={common} aria-label="Primeiro ciclo">
        <ListTree className="size-4 shrink-0 text-hz-accent" strokeWidth={1.8} />
        <p className="min-w-0 flex-1 text-xs text-text-tertiary">
          <strong className="text-text-primary">
            {progress.connectedCount} de {progress.targetCount} ideias conectadas.
          </strong>{" "}
          Adicione mais uma ideia para formar um pequeno conjunto reutilizável.
        </p>
        <Button
          size="sm"
          className="h-7 shrink-0 gap-1.5 border-text-primary bg-text-primary px-2.5 text-2xs text-background-primary"
          onClick={() => void notes.newNote()}
        >
          <PenLine className="size-3" strokeWidth={2} />
          Criar próxima captura
        </Button>
      </aside>
    );
  }

  if (progress.stage === "process") {
    return (
      <aside className={common} aria-label="Primeiro ciclo">
        <Sparkles className="size-4 shrink-0 text-hz-accent" strokeWidth={1.8} />
        <p className="min-w-0 flex-1 text-xs text-text-tertiary">
          <strong className="text-text-primary">
            Captura {progress.connectedCount + 1} de {progress.targetCount} feita.
          </strong>{" "}
          Agora transforme-a em uma nota permanente e conecte-a ao mapa.
        </p>
        <Button
          size="sm"
          className="h-7 shrink-0 gap-1.5 border-text-primary bg-text-primary px-2.5 text-2xs text-background-primary"
          onClick={() => {
            void (async () => {
              const persisted = await notes.persistDraft();
              if (persisted) navigation.setView("process");
            })();
          }}
        >
          Processar captura
        </Button>
      </aside>
    );
  }

  if (progress.stage === "connect") {
    return (
      <aside className={common} aria-label="Primeiro ciclo">
        <Link2 className="size-4 shrink-0 text-hz-accent" strokeWidth={1.8} />
        <p className="text-xs text-text-tertiary">
          <strong className="text-text-primary">A ideia já é permanente.</strong> Conecte-a ao
          mapa e escreva por que elas se relacionam.
        </p>
      </aside>
    );
  }

  return (
    <aside className={common} aria-label="Primeiro ciclo concluído">
      <Check className="size-4 shrink-0 text-[#1c6b45]" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-xs text-text-tertiary">
        <strong className="text-text-primary">Primeiro ciclo concluído.</strong> Você criou
        três ideias permanentes e registrou como elas se conectam ao seu mapa.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-2xs"
        onClick={() => navigation.toggleMap("explore")}
      >
        Ver conexão
      </Button>
    </aside>
  );
}
