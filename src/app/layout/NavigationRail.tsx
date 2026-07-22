/**
 * Coluna de navegação. Construída sobre o suite Sidebar do Relume
 * (SidebarProvider/SidebarMenu/SidebarMenuBadge), que já entrega colapso,
 * estados de hover/ativo e as contagens alinhadas à direita.
 */

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
  cn
} from "@relume_io/relume-ui";
import {
  Archive,
  BookOpen,
  Bookmark,
  Brain,
  FileStack,
  FolderKanban,
  Gem,
  Home,
  Hourglass,
  Inbox,
  Layers,
  Library,
  ListTree,
  Network,
  NotebookPen,
  PanelLeftClose,
  Repeat2,
  Sprout,
  Target,
  type LucideIcon
} from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNavigation, type MapTab } from "@/app/providers/NavigationProvider";
import {
  FOLDER_LABELS,
  KIND_LABELS,
  scopeKey,
  type FolderId,
  type NoteKind,
  type Scope
} from "@/domain/notes";
import { formatShortcut } from "@/shared/platform";

const NAV_ITEM_CLASS = cn(
  "relative h-8 gap-2.5 rounded-md px-2 text-[13px] font-normal text-text-primary",
  "hover:bg-hz-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent focus-visible:ring-offset-1 focus-visible:ring-offset-hz-rail",
  "data-[active=true]:!bg-hz-nav-active data-[active=true]:!font-medium data-[active=true]:!text-text-primary data-[active=true]:hover:!bg-hz-nav-active"
);

function navIconClass(isActive: boolean): string {
  return cn("size-4 shrink-0", isActive ? "text-text-primary" : "text-text-secondary");
}

function navBadgeClass(isActive: boolean): string {
  return cn(
    "top-1.5 text-2xs tabular-nums",
    isActive ? "font-medium text-text-primary" : "text-text-secondary"
  );
}

function SelectionMarker({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-hz-nav-active-bar"
    />
  );
}

const FOLDER_ICONS: Record<FolderId, LucideIcon> = {
  inbox: Inbox,
  projects: FolderKanban,
  areas: Target,
  resources: Library,
  journal: NotebookPen,
  someday: Hourglass,
  archive: Archive
};

const KIND_ICONS: Record<NoteKind, LucideIcon> = {
  fleeting: Sprout,
  source: BookOpen,
  permanent: Gem,
  structure: ListTree,
  reference: Bookmark
};

interface RowProps {
  icon: LucideIcon;
  label: string;
  count?: number;
  scope: Scope;
}

function NavRow({ icon: Icon, label, count, scope }: RowProps) {
  const notes = useNotes();
  const navigation = useNavigation();
  /*
   * A coleção escolhida só está "aberta" quando a lista está à vista. Sem a
   * checagem da tela, o escopo padrão deixava "Todas as notas" destacado ao
   * mesmo tempo que o Início — dois itens dizendo "você está aqui".
   */
  const isActive = navigation.view === "note" && scopeKey(notes.scope) === scopeKey(scope);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        aria-current={isActive ? "page" : undefined}
        // Escolher uma coleção sai do início e mostra a lista de notas.
        onClick={() => {
          notes.setScope(scope);
          navigation.setView("note");
        }}
        className={NAV_ITEM_CLASS}
      >
        <SelectionMarker active={isActive} />
        <Icon
          className={navIconClass(isActive)}
          strokeWidth={1.75}
        />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      {typeof count === "number" && count > 0 ? (
        <SidebarMenuBadge
          className={navBadgeClass(isActive)}
        >
          {count}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

/** Entrada que leva ao mapa, já numa aba específica. */
function MapRow({
  icon: Icon,
  label,
  tab,
  badge
}: {
  icon: LucideIcon;
  label: string;
  tab: MapTab;
  /** Só entradas que contam coisas levam número; retenção é porcentagem. */
  badge?: number;
}) {
  const navigation = useNavigation();
  const isActive = navigation.view === "map" && navigation.mapTab === tab;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        aria-current={isActive ? "page" : undefined}
        onClick={() => navigation.toggleMap(tab)}
        title={`${label} (${formatShortcut("G")})`}
        className={NAV_ITEM_CLASS}
      >
        <SelectionMarker active={isActive} />
        <Icon
          className={navIconClass(isActive)}
          strokeWidth={1.75}
        />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      {typeof badge === "number" && badge > 0 ? (
        <SidebarMenuBadge
          className={navBadgeClass(isActive)}
        >
          {badge}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function GroupLabel({ children }: { children: string }) {
  return (
    <SidebarGroupLabel className="h-6 px-2 text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
      {children}
    </SidebarGroupLabel>
  );
}

export function NavigationRail() {
  const notes = useNotes();
  const knowledge = useKnowledge();
  const navigation = useNavigation();
  const { state } = useSidebar();
  const folders = Object.keys(FOLDER_LABELS) as FolderId[];
  const kinds = Object.keys(KIND_LABELS) as NoteKind[];
  const homeActive = navigation.view === "home";
  const processActive = navigation.view === "process";

  return (
    <Sidebar
      collapsible="icon"
      /*
       * O Relume posiciona esta coluna como `fixed h-svh`, o que a faria
       * cobrir a barra de estado. Encurtamos pela altura dela (h-8 = 2rem)
       * para que a barra atravesse a janela inteira, como no layout de origem.
       */
      className="border-r border-border-primary md:!top-[var(--window-titlebar-height)] md:!h-[calc(100svh_-_2rem_-_var(--window-titlebar-height))] [&>[data-sidebar=sidebar]]:bg-hz-rail"
    >
      {/*
        O Relume esconde sozinho os rótulos e contadores no modo compacto, mas
        só dentro dos componentes dele. Este cabeçalho é marcação própria, e
        sem a regra abaixo o nome do app transbordava por cima do painel
        vizinho quando a coluna encolhia.
      */}
      {/*
        O logo precisa cair na mesma coluna dos ícones abaixo, e eles não
        estão no padding do menu: ficam dentro de um botão que tem padding
        próprio. Daí o `px-2` do cabeçalho (igual ao do conteúdo) mais o
        `pl-2` da linha (igual ao do botão) — sem isso o logo ficava 8px à
        esquerda no modo compacto e 4px no expandido.

        O nome some quando a coluna encolhe: o Relume só esconde rótulos
        dentro dos componentes dele, e este cabeçalho é marcação própria.
      */}
      <SidebarHeader className="h-11 shrink-0 justify-center px-2 py-0">
        <div className="flex h-8 items-center gap-2.5 pl-2">
          {state === "collapsed" ? (
            <SidebarTrigger
              className="-ml-2 size-10 shrink-0 rounded-md text-text-secondary hover:bg-hz-hover focus-visible:ring-2 focus-visible:ring-hz-accent"
              aria-label="Expandir navegação"
              title="Expandir navegação"
            >
              <span className="grid size-6 place-items-center rounded-md bg-text-primary text-background-primary">
                <Brain className="size-3.5" strokeWidth={2} />
              </span>
            </SidebarTrigger>
          ) : (
            <span className="grid size-6 place-items-center rounded-md bg-text-primary text-background-primary">
              <Brain className="size-3.5" strokeWidth={2} />
            </span>
          )}
          <span className="truncate text-[13px] font-semibold tracking-[-0.01em] group-data-[collapsible=icon]:hidden">
            Hyperzettel
          </span>
          {state === "expanded" ? (
            <SidebarTrigger
              className="ml-auto size-8 shrink-0 rounded-md text-text-secondary hover:bg-hz-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-hz-accent"
              aria-label="Recolher navegação"
              title="Recolher navegação"
            >
              <PanelLeftClose className="size-4" strokeWidth={1.8} />
            </SidebarTrigger>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="hz-scroll gap-0 px-2 pb-2">
        <SidebarGroup className="px-0 py-1.5">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={homeActive}
                  aria-current={homeActive ? "page" : undefined}
                  onClick={() => navigation.setView("home")}
                  className={NAV_ITEM_CLASS}
                >
                  <SelectionMarker active={homeActive} />
                  <Home
                    className={navIconClass(homeActive)}
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Início</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <NavRow
                icon={Inbox}
                label="Entrada"
                count={notes.folderCounts.inbox}
                scope={{ kind: "folder", value: "inbox" }}
              />
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={processActive}
                  aria-current={processActive ? "page" : undefined}
                  onClick={() => navigation.setView("process")}
                  className={NAV_ITEM_CLASS}
                >
                  <SelectionMarker active={processActive} />
                  <Layers
                    className={navIconClass(processActive)}
                    strokeWidth={1.75}
                  />
                  <span className="truncate">Processar</span>
                </SidebarMenuButton>
                <SidebarMenuBadge className={navBadgeClass(processActive)}>
                  {notes.processQueue.length}
                </SidebarMenuBadge>
              </SidebarMenuItem>
              <NavRow
                icon={FileStack}
                label="Todas as notas"
                count={notes.folderCounts.all}
                scope={{ kind: "all", value: "all" }}
              />
              <NavRow
                icon={Archive}
                label="Arquivo"
                count={notes.folderCounts.archive}
                scope={{ kind: "folder", value: "archive" }}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="px-0 py-1.5">
          <GroupLabel>Pastas</GroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {folders
                .filter((folder) => folder !== "inbox" && folder !== "archive")
                .map((folder) => (
                  <NavRow
                    key={folder}
                    icon={FOLDER_ICONS[folder]}
                    label={FOLDER_LABELS[folder]}
                    count={notes.folderCounts[folder]}
                    scope={{ kind: "folder", value: folder }}
                  />
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/*
          Navegação por estágio do ciclo, não por modelo de documento: o que
          interessa percorrer é o que ainda falta destilar, não quais notas
          usaram o mesmo gabarito.
        */}
        <SidebarGroup className="px-0 py-1.5">
          <GroupLabel>Ciclo</GroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {kinds.map((kind) => (
                <NavRow
                  key={kind}
                  icon={KIND_ICONS[kind]}
                  label={KIND_LABELS[kind]}
                  count={notes.kindCounts[kind]}
                  scope={{ kind: "kind", value: kind }}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="px-0 py-1.5">
          <GroupLabel>Aprendizagem</GroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <MapRow icon={Network} label="Mapa" tab="explore" />
              <MapRow
                icon={Repeat2}
                label="A revisar"
                tab="review"
                badge={knowledge.snapshot.metrics.reviewDue}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
