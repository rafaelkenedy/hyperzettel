import { useState, type FormEvent } from "react";
import { Button } from "@relume_io/relume-ui";
import { ArrowRight, Link2, ListTree, PenLine } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { normalizeGuidedSubject } from "./guidedOnboarding";

const STEPS = [
  {
    icon: ListTree,
    title: "Crie um mapa",
    body: "Comece por um assunto real, não por uma configuração."
  },
  {
    icon: PenLine,
    title: "Escreva três ideias",
    body: "Uma ideia pequena e compreensível por nota."
  },
  {
    icon: Link2,
    title: "Explique as conexões",
    body: "Registre por que cada ideia pertence a esse mapa."
  }
] as const;

export function GuidedStart() {
  const notes = useNotes();
  const [subject, setSubject] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeGuidedSubject(subject);
    if (normalized.length < 3) {
      setError("Escreva um assunto com pelo menos três caracteres.");
      return;
    }

    setError("");
    setStarting(true);
    try {
      await notes.startGuidedTopic(normalized);
    } finally {
      setStarting(false);
    }
  };

  return (
    <article className="mt-6 overflow-hidden rounded-2xl border border-border-primary bg-background-primary shadow-panel">
      <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="p-6 sm:p-8">
          <span className="text-2xs font-medium uppercase tracking-[0.08em] text-hz-accent">
            Seu primeiro ciclo
          </span>
          <h2 className="mt-2 max-w-[34rem] text-xl font-bold tracking-[-0.02em]">
            Qual assunto merece virar conhecimento conectado?
          </h2>
          <p className="mt-2 max-w-[38rem] text-sm leading-relaxed text-text-tertiary">
            O Hyperzettel cria um mapa inicial e conduz você da primeira ideia até as
            primeiras conexões. Você começa produzindo algo útil, sem precisar aprender o
            método antes.
          </p>

          <form className="mt-6" onSubmit={(event) => void submit(event)}>
            <label htmlFor="guided-subject" className="text-xs font-semibold text-text-primary">
              Assunto que você quer desenvolver
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="guided-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Ex.: como a inflação afeta os juros"
                maxLength={120}
                aria-describedby={error ? "guided-subject-error" : "guided-subject-help"}
                aria-invalid={Boolean(error)}
                autoFocus
                className="h-10 min-w-0 flex-1 rounded-md border border-border-primary bg-background-primary px-3 text-sm outline-none transition-colors placeholder:text-text-secondary focus:border-hz-accent focus:ring-2 focus:ring-hz-accent/20"
              />
              <Button
                type="submit"
                disabled={starting}
                className="h-10 shrink-0 gap-1.5 border-text-primary bg-text-primary px-4 text-xs text-background-primary"
              >
                {starting ? "Criando mapa…" : "Criar meu mapa"}
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </Button>
            </div>
            {error ? (
              <p id="guided-subject-error" role="alert" className="mt-2 text-xs text-danger">
                {error}
              </p>
            ) : (
              <p id="guided-subject-help" className="mt-2 text-2xs text-text-secondary">
                Use um tema que você realmente precisa compreender, decidir ou explicar.
              </p>
            )}
          </form>

          <button
            type="button"
            onClick={() => void notes.newNote()}
            className="mt-5 text-xs font-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
          >
            Prefiro começar com uma nota em branco
          </button>
        </div>

        <ol className="border-t border-border-secondary bg-background-secondary p-6 lg:border-l lg:border-t-0">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="flex gap-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background-primary text-text-secondary">
                <Icon className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <span>
                <span className="block text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
                  Passo {index + 1}
                </span>
                <span className="mt-0.5 block text-xs font-semibold">{title}</span>
                <span className="mt-0.5 block text-2xs leading-relaxed text-text-tertiary">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
