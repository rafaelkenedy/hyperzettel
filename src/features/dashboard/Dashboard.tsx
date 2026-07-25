/**
 * Página inicial.
 *
 * Organizada por ação, não por seção decorativa: um cartão de foco que reage
 * ao estado real do workspace, números que levam a algum lugar, notas
 * recentes e os modelos agrupados por propósito.
 */

import { useMemo } from "react";
import { Button, cn } from "@relume_io/relume-ui";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  CalendarRange,
  FileText,
  FolderKanban,
  Inbox,
  Lightbulb,
  Link2,
  PenLine,
  Signpost,
  Target,
  Timer,
  Users,
  type LucideIcon
} from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import { ALL_SCOPE, FOLDER_LABELS, type TemplateId } from "@/domain/notes";
import {
  TEMPLATES,
  TEMPLATE_GROUPS,
  type NoteTemplate,
  type TemplateGroup
} from "@/domain/templates";
import { formatRelative, toPlainText } from "@/shared/html";
import { formatShortcut } from "@/shared/platform";

const TEMPLATE_ICONS: Record<TemplateId, LucideIcon> = {
  blank: FileText,
  project: FolderKanban,
  area: Target,
  concept: Lightbulb,
  reference: BookOpen,
  session: Timer,
  decision: Signpost,
  meeting: Users,
  daily: CalendarDays,
  weekly: CalendarRange
};

/**
 * A cor vem da família, não do modelo. Assim ela carrega significado em vez
 * de repetir o nome que já está escrito logo abaixo.
 */
const GROUP_TONE: Record<TemplateGroup, string> = {
  pensar: "bg-[#e9eefb] text-[#2f5aa8]",
  conduzir: "bg-[#efecfd] text-[#6a4fd0]",
  registrar: "bg-[#fdf1dd] text-[#8a5a12]",
  ritmo: "bg-[#e8f4ec] text-[#1c6b45]"
};

function TemplateCard({ template }: { template: NoteTemplate }) {
  const notes = useNotes();
  const Icon = TEMPLATE_ICONS[template.id];

  return (
    <button
      type="button"
      onClick={() => void notes.newNoteFromTemplate(template.id)}
      className="flex items-start gap-3 rounded-xl border border-border-primary bg-background-primary p-3.5 text-left transition-colors hover:border-hz-accent/40 hover:bg-background-secondary"
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          GROUP_TONE[template.group]
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold leading-snug">{template.name}</span>
        <span className="mt-0.5 block text-2xs leading-snug text-text-tertiary">
          {template.description}
        </span>
      </span>
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  supporting,
  tone,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  supporting: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-border-primary bg-background-primary p-4 text-left shadow-panel transition-colors hover:border-hz-accent/40 hover:bg-background-secondary"
    >
      <span className="flex items-center justify-between">
        <span className={cn("grid size-8 place-items-center rounded-lg", tone)}>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <ArrowRight
          className="size-3.5 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100"
          strokeWidth={2}
        />
      </span>
      <span className="mt-3 block text-2xl font-bold tabular-nums leading-none tracking-[-0.02em]">
        {value}
      </span>
      <span className="mt-1 block text-xs font-medium">{label}</span>
      <span className="block text-2xs text-text-secondary">{supporting}</span>
    </button>
  );
}

export function Dashboard() {
  const notes = useNotes();
  const knowledge = useKnowledge();
  const navigation = useNavigation();

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long"
      }).format(new Date()),
    []
  );

  const recent = useMemo(
    () =>
      [...notes.notes]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 3),
    [notes.notes]
  );

  const connections = notes.notes.reduce((total, note) => total + note.connections.length, 0);
  const reviewDue = knowledge.snapshot.metrics.reviewDue;
  const inboxCount = notes.folderCounts.inbox ?? 0;
  // Primeira execução: sem notas, um painel de métricas zeradas e um "Retomar"
  // vazio só reforçam o vazio. Nesse estado a home lidera com a ação de criar.
  const hasNotes = notes.notes.length > 0;

  /**
   * O cartão de foco responde ao estado real: revisar vem antes de organizar,
   * que vem antes de escrever. Sem isso a home dizia a mesma coisa todo dia.
   */
  const focus = reviewDue
    ? {
        eyebrow: "Sua memória pede atenção",
        title: `${reviewDue} ${reviewDue === 1 ? "nota está esfriando" : "notas estão esfriando"}`,
        body: "A retenção estimada dessas notas caiu abaixo de 55%. Revisar reforça a nota e todas as conexões ligadas a ela.",
        action: "Abrir fila de revisão",
        run: () => navigation.toggleMap("review"),
        tone: "bg-[#fdeef1] text-[#a3324c]",
        icon: Brain
      }
    : inboxCount
      ? {
          eyebrow: "Caixa de entrada",
          title: `${inboxCount} ${inboxCount === 1 ? "nota esperando destino" : "notas esperando destino"}`,
          body: "Processar a entrada é o que impede a captura de virar acúmulo. O fluxo pergunta uma coisa de cada vez até a ideia virar nota conectada.",
          action: "Processar entrada",
          run: () => navigation.setView("process"),
          tone: "bg-[#fdf1dd] text-[#8a5a12]",
          icon: Inbox
        }
      : {
          eyebrow: hasNotes ? "Tudo em dia" : "Primeiros passos",
          title: hasNotes ? "Nada pendente, o espaço é seu" : "Comece pela primeira nota",
          body: hasNotes
            ? "Sem revisões nem caixa de entrada esperando. Um bom momento para escrever algo novo ou revisitar uma conexão."
            : "Capture uma ideia solta ou escolha um modelo abaixo. O Hyperzettel organiza, conecta e ajuda a revisar depois.",
          // No first-run, a nota em branco é o primeiro passo mais gentil que um
          // modelo estruturado; os modelos ficam logo abaixo para quem quiser.
          action: hasNotes ? "Escrever nota diária" : "Escrever livremente",
          run: hasNotes
            ? () => void notes.newNoteFromTemplate("daily")
            : () => void notes.newNote(),
          tone: "bg-[#e8f4ec] text-[#1c6b45]",
          icon: PenLine
        };

  const FocusIcon = focus.icon;

  const groups = Object.keys(TEMPLATE_GROUPS) as TemplateGroup[];

  return (
    <section className="hz-scroll h-full min-w-0 flex-1 overflow-y-auto bg-background-secondary">
      <div className="mx-auto w-full max-w-[64rem] px-10 py-10">
        <header className="flex items-end justify-between gap-6">
          <div>
            <span className="text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
              {today}
            </span>
            <h1 className="mt-1.5 text-[1.75rem] font-bold leading-[1.15] tracking-[-0.02em]">
              {hasNotes ? "Que ideia merece sua atenção hoje?" : "Sua primeira ideia começa aqui"}
            </h1>
          </div>
          {/* Secundário de propósito: o CTA primário da tela é a ação do
              cartão de foco, para não competirem dois botões escuros. */}
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 gap-1.5 border-border-tertiary bg-background-primary text-xs"
            onClick={() => void notes.newNote()}
          >
            <PenLine className="size-3.5" strokeWidth={2} />
            Nova nota
          </Button>
        </header>

        <article className="mt-6 flex items-start gap-4 rounded-xl border border-border-primary bg-background-primary p-5 shadow-panel">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", focus.tone)}>
            <FocusIcon className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
              {focus.eyebrow}
            </span>
            <h2 className="mt-1 text-lg font-bold tracking-[-0.01em]">{focus.title}</h2>
            <p className="mt-1.5 max-w-[46rem] text-xs leading-relaxed text-text-tertiary">
              {focus.body}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 border-text-primary bg-text-primary text-xs text-background-primary"
                onClick={focus.run}
              >
                {focus.action}
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </Button>
              {/* No first-run o CTA primário já é a nota em branco, então o
                  "Escrever livremente" secundário seria redundante. */}
              {hasNotes ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="border-border-tertiary bg-background-primary text-xs"
                  onClick={() => void notes.newNote()}
                >
                  Escrever livremente
                </Button>
              ) : null}
            </div>
          </div>
        </article>

        {hasNotes ? (
        <section aria-label="Resumo" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={FileText}
            label="Notas"
            value={notes.notes.length}
            supporting="ver a coleção"
            tone="bg-[#e9eefb] text-[#2f5aa8]"
            onClick={() => {
              notes.setScope(ALL_SCOPE);
              navigation.setView("note");
            }}
          />
          <StatCard
            icon={Inbox}
            label="Caixa de entrada"
            value={inboxCount}
            supporting="para organizar"
            tone="bg-[#fdf1dd] text-[#8a5a12]"
            onClick={() => {
              notes.setScope({ kind: "folder", value: "inbox" });
              navigation.setView("note");
            }}
          />
          <StatCard
            icon={Link2}
            label="Conexões"
            value={connections}
            supporting="ver no grafo"
            tone="bg-[#efecfd] text-[#6a4fd0]"
            onClick={() => navigation.toggleMap("explore")}
          />
          <StatCard
            icon={Brain}
            label="Retenção"
            value={`${Math.round(knowledge.snapshot.metrics.average * 100)}%`}
            supporting={`${reviewDue} a revisar`}
            tone="bg-[#e8f4ec] text-[#1c6b45]"
            onClick={() => navigation.toggleMap("review")}
          />
        </section>
        ) : null}

        {hasNotes ? (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-md font-bold tracking-[-0.01em]">Retomar de onde parou</h2>
            <Button
              variant="link"
              size="sm"
              className="gap-1 px-0 text-xs text-text-secondary hover:text-hz-accent"
              onClick={() => {
                notes.setScope(ALL_SCOPE);
                navigation.setView("note");
              }}
            >
              Ver todas
              <ArrowRight className="size-3.5" strokeWidth={2} />
            </Button>
          </div>

          {recent.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-border-tertiary bg-background-primary px-4 py-10 text-center text-xs text-text-secondary">
              As notas recentes aparecerão aqui.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {recent.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => void notes.openNote(note.id)}
                  className="rounded-xl border border-border-primary bg-background-primary p-4 text-left shadow-panel transition-colors hover:border-hz-accent/40 hover:bg-background-secondary"
                >
                  {/* Sem `block`: ele sobrescreve o display que o line-clamp
                      precisa e o texto deixa de ser cortado. */}
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
                    {note.title || "Sem título"}
                  </span>
                  <span className="mt-1.5 line-clamp-3 text-2xs leading-relaxed text-text-tertiary">
                    {toPlainText(note.content)}
                  </span>
                  <span className="mt-3 flex items-center gap-1.5 text-2xs text-text-secondary">
                    {FOLDER_LABELS[note.folder]}
                    <span aria-hidden>·</span>
                    {formatRelative(note.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        ) : null}

        <section className="mt-8">
          <h2 className="text-md font-bold tracking-[-0.01em]">Comece com uma estrutura</h2>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Cada modelo abre a nota já com as seções que aquele tipo de pensamento pede.
          </p>

          <div className="mt-4 flex flex-col gap-5">
            {groups.map((group) => {
              const templates = TEMPLATES.filter(
                (template) => template.group === group && template.id !== "blank"
              );
              if (!templates.length) return null;

              return (
                <div key={group}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
                      {TEMPLATE_GROUPS[group].label}
                    </h3>
                    <span className="text-2xs text-text-secondary">
                      {TEMPLATE_GROUPS[group].hint}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {templates.map((template) => (
                      <TemplateCard key={template.id} template={template} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="mt-10 border-t border-border-secondary pt-4 text-2xs text-text-secondary">
          {formatShortcut("N")} nova nota · {formatShortcut("K")} buscar ·{" "}
          {formatShortcut("G")} mapa de conhecimento
        </footer>
      </div>
    </section>
  );
}
