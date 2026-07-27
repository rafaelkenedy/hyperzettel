/**
 * Regras puras de notas, pastas, tipos, conexões, filtros e contagens.
 * Nenhuma dependência de DOM ou IndexedDB.
 */

export const FOLDER_LABELS = {
  inbox: "Entrada",
  projects: "Projetos",
  areas: "Áreas",
  resources: "Recursos",
  journal: "Diário",
  /** Destino do "talvez seja útil depois" no fluxo de processamento. */
  someday: "Incubadora",
  archive: "Arquivo"
} as const;

export type FolderId = keyof typeof FOLDER_LABELS;

/**
 * Tipo epistêmico da nota — o ciclo de vida do Zettelkasten.
 *
 * É diferente do `template`, que descreve só a estrutura do documento
 * ("painel de projeto", "nota de reunião"). Aqui o que importa é a maturidade
 * da ideia: uma captura crua e uma ideia já reescrita com as próprias
 * palavras podem usar o mesmo modelo e mesmo assim estar em estágios
 * completamente diferentes.
 */
export const KIND_LABELS = {
  fleeting: "Fugaz",
  source: "Fonte",
  permanent: "Permanente",
  structure: "Estrutura",
  reference: "Referência"
} as const;

export type NoteKind = keyof typeof KIND_LABELS;

export const KIND_HINTS: Record<NoteKind, string> = {
  fleeting: "Captura rápida, ainda não processada.",
  source: "Registro do que a fonte disse, com a referência.",
  permanent: "Uma ideia, explicada com suas palavras.",
  structure: "Mapa que organiza outras notas (MOC).",
  reference: "Guardada apenas para consulta."
};

export const TEMPLATE_LABELS = {
  project: "Projeto",
  area: "Área",
  reference: "Referência",
  concept: "Conceito",
  study: "Estudo",
  session: "Sessão",
  decision: "Decisão",
  meeting: "Reunião",
  daily: "Diário",
  weekly: "Semanal",
  blank: "Livre"
} as const;

export type TemplateId = keyof typeof TEMPLATE_LABELS;

export type NoteStatus = "draft" | "saved";

/**
 * Autosave persiste o conteúdo, mas não deve regredir o ciclo de vida de uma
 * nota que o usuário já concluiu explicitamente.
 */
export function resolvePersistedStatus(
  requested: NoteStatus,
  existing: NoteStatus | undefined
): NoteStatus {
  return requested === "saved" || existing === "saved" ? "saved" : "draft";
}

/**
 * Uma conexão guarda o motivo, não só o destino.
 *
 * É o que separa referência de raciocínio: registrar *por que* duas notas se
 * relacionam transforma o link em pensamento. O motivo é opcional para não
 * travar a captura, mas a interface sempre o pede.
 */
export interface Connection {
  id: string;
  reason: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  /** Pergunta opcional mostrada antes do conteúdo durante a recuperação ativa. */
  recallPrompt: string;
  folder: FolderId;
  kind: NoteKind;
  template: TemplateId;
  connections: Connection[];
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  id: string;
  title?: string;
  content?: string;
  recallPrompt?: string;
  folder?: string;
  kind?: string;
  template?: string;
  connections?: unknown;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  now?: string;
}

const FOLDER_IDS = Object.keys(FOLDER_LABELS) as FolderId[];
const TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as TemplateId[];
const KIND_IDS = Object.keys(KIND_LABELS) as NoteKind[];

export function isFolderId(value: unknown): value is FolderId {
  return typeof value === "string" && FOLDER_IDS.includes(value as FolderId);
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && TEMPLATE_IDS.includes(value as TemplateId);
}

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === "string" && KIND_IDS.includes(value as NoteKind);
}

/**
 * Tipo epistêmico presumido a partir do modelo, usado só quando a nota ainda
 * não tem um. É um palpite de migração: notas de conceito já foram
 * destiladas, painéis funcionam como mapas e registros seguem por processar.
 */
const KIND_FROM_TEMPLATE: Record<TemplateId, NoteKind> = {
  concept: "permanent",
  study: "permanent",
  reference: "source",
  project: "structure",
  area: "structure",
  session: "fleeting",
  decision: "fleeting",
  meeting: "fleeting",
  daily: "fleeting",
  weekly: "fleeting",
  blank: "fleeting"
};

export function createId(prefix = "note"): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function normalizeDate(value: unknown, fallback: string): string {
  const date = new Date(typeof value === "string" ? value : "");
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/**
 * Aceita as duas formas: a antiga (`string[]` de ids) e a atual (objetos com
 * motivo). Mantém a primeira ocorrência de cada id e preserva o motivo já
 * registrado, para que a migração não apague texto escrito pela pessoa.
 */
export function normalizeConnections(value: unknown): Connection[] {
  if (!Array.isArray(value)) return [];

  const byId = new Map<string, Connection>();
  value.forEach((item) => {
    if (typeof item === "string") {
      const id = item.trim();
      if (id && !byId.has(id)) byId.set(id, { id, reason: "" });
      return;
    }
    if (!item || typeof item !== "object") return;

    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    if (!id) return;

    const reason = typeof source.reason === "string" ? source.reason.trim().slice(0, 500) : "";
    const existing = byId.get(id);
    if (!existing) byId.set(id, { id, reason });
    else if (!existing.reason && reason) existing.reason = reason;
  });

  return Array.from(byId.values());
}

export function connectionIds(connections: Connection[]): string[] {
  return connections.map((connection) => connection.id);
}

export function createNoteRecord(input: NoteInput): Note {
  const now = input.now ?? new Date().toISOString();
  const template = isTemplateId(input.template) ? input.template : "blank";
  return {
    id: input.id,
    title: input.title?.trim() || "Sem título",
    content: input.content ?? "",
    recallPrompt: input.recallPrompt?.trim().slice(0, 300) ?? "",
    folder: isFolderId(input.folder) ? input.folder : "inbox",
    kind: isNoteKind(input.kind) ? input.kind : KIND_FROM_TEMPLATE[template],
    template,
    connections: normalizeConnections(input.connections),
    status: input.status === "saved" ? "saved" : "draft",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  };
}

export function normalizeImportedNote(
  value: unknown,
  options: { sanitizeContent: (value: unknown) => string; now?: string }
): Note | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const { sanitizeContent, now = new Date().toISOString() } = options;
  const id =
    typeof source.id === "string" && source.id.trim() ? source.id.trim() : createId();
  const template = isTemplateId(source.template) ? source.template : "blank";

  return {
    id,
    title:
      typeof source.title === "string" && source.title.trim()
        ? source.title.trim().slice(0, 240)
        : "Sem título",
    content: sanitizeContent(source.content),
    recallPrompt:
      typeof source.recallPrompt === "string"
        ? source.recallPrompt.trim().slice(0, 300)
        : "",
    folder: isFolderId(source.folder) ? source.folder : "inbox",
    kind: isNoteKind(source.kind) ? source.kind : KIND_FROM_TEMPLATE[template],
    template,
    // `links` é o nome do campo nos backups antigos do Hyperzettelkasten.
    connections: normalizeConnections(source.connections ?? source.links),
    status: source.status === "draft" ? "draft" : "saved",
    createdAt: normalizeDate(source.createdAt, now),
    updatedAt: normalizeDate(source.updatedAt, now)
  };
}

/** Um registro precisa de migração quando falta `kind` ou as conexões são ids soltos. */
export function needsMigration(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (!isNoteKind(source.kind)) return true;
  const connections = source.connections;
  return Array.isArray(connections) && connections.some((item) => typeof item === "string");
}

export function mergeNote(notes: Note[], note: Note): Note[] {
  const result = notes.slice();
  const index = result.findIndex((item) => item.id === note.id);
  if (index >= 0) result[index] = { ...result[index], ...note };
  else result.push(note);
  return result;
}

/**
 * A nota diária de hoje, se já existir. Identificada pelo template `daily` e
 * pelo título no formato ISO curto que o modelo gera (AAAA-MM-DD). Manter a
 * regra pura permite testá-la e evita duplicar diárias (A1 do design review).
 *
 * @example findTodaysDaily(notes, "2026-07-24")?.id
 */
export function findTodaysDaily(notes: Note[], todayTitle: string): Note | undefined {
  return notes.find((note) => note.template === "daily" && note.title === todayTitle);
}

export type FolderCounts = Record<string, number>;

export function countByFolder(notes: Note[]): FolderCounts {
  const counts: FolderCounts = { all: notes.length };
  FOLDER_IDS.forEach((folder) => {
    counts[folder] = 0;
  });
  notes.forEach((note) => {
    if (Object.hasOwn(counts, note.folder)) counts[note.folder] += 1;
  });
  return counts;
}

export function countByKind(notes: Note[]): FolderCounts {
  const counts: FolderCounts = {};
  KIND_IDS.forEach((kind) => {
    counts[kind] = 0;
  });
  notes.forEach((note) => {
    if (Object.hasOwn(counts, note.kind)) counts[note.kind] += 1;
  });
  return counts;
}

/**
 * Conexões são bidirecionais: uma nota A que aponta para B conta como
 * conexão para as duas. Auto-referências e alvos inexistentes são ignorados.
 */
export function createConnectionCounts(notes: Note[]): Map<string, number> {
  const noteIds = new Set(notes.map((note) => note.id));
  const connectedIds = new Map<string, Set<string>>(
    notes.map((note) => [note.id, new Set<string>()])
  );

  notes.forEach((note) => {
    connectionIds(normalizeConnections(note.connections)).forEach((linkedId) => {
      if (linkedId === note.id || !noteIds.has(linkedId)) return;
      connectedIds.get(note.id)?.add(linkedId);
      connectedIds.get(linkedId)?.add(note.id);
    });
  });

  return new Map(Array.from(connectedIds, ([noteId, ids]) => [noteId, ids.size]));
}

/**
 * Total de arestas não direcionadas do conjunto.
 *
 * `createConnectionCounts` atribui cada relação às duas pontas; dividir a soma
 * por dois mantém links unilaterais e recíprocos como uma única conexão.
 */
export function countUniqueConnections(notes: Note[]): number {
  const endpointCount = [...createConnectionCounts(notes).values()].reduce(
    (total, count) => total + count,
    0
  );
  return endpointCount / 2;
}

export type RelationDirection = "mutual" | "outgoing" | "incoming";

export interface Relation {
  note: Note;
  direction: RelationDirection;
  /** Motivo que esta nota registrou. Vazio quando só a outra declarou. */
  reason: string;
  /** Motivo que a outra ponta registrou sobre esta nota. */
  incomingReason: string;
}

const DIRECTION_ORDER: Record<RelationDirection, number> = {
  mutual: 0,
  outgoing: 1,
  incoming: 2
};

/**
 * Todas as notas relacionadas, uma vez cada.
 *
 * Conexão é uma aresta sem direção — é assim que o grafo conta e é assim que
 * a pessoa pensa. Separar "aponta para" de "é apontada por" fazia a mesma
 * nota aparecer duas vezes sempre que as duas pontas se declaravam, que é a
 * maioria dos casos. A direção vira um detalhe da relação, não dois blocos.
 */
export function findRelations(notes: Note[], noteId: string): Relation[] {
  const source = notes.find((note) => note.id === noteId);
  const outgoing = new Map(
    normalizeConnections(source?.connections).map((item) => [item.id, item.reason])
  );

  return notes
    .filter((note) => note.id !== noteId)
    .map((note) => {
      const declared = outgoing.get(note.id);
      const incoming = normalizeConnections(note.connections).find(
        (item) => item.id === noteId
      );
      if (declared === undefined && !incoming) return null;

      const direction: RelationDirection =
        declared !== undefined && incoming
          ? "mutual"
          : declared !== undefined
            ? "outgoing"
            : "incoming";

      return {
        note,
        direction,
        reason: declared ?? "",
        incomingReason: incoming?.reason ?? ""
      };
    })
    .filter((item): item is Relation => item !== null)
    .sort(
      (left, right) =>
        DIRECTION_ORDER[left.direction] - DIRECTION_ORDER[right.direction] ||
        left.note.title.localeCompare(right.note.title, "pt-BR")
    );
}

export type ScopeKind = "all" | "folder" | "kind";

export interface Scope {
  kind: ScopeKind;
  value: string;
}

export const ALL_SCOPE: Scope = { kind: "all", value: "all" };

export function scopeKey(scope: Scope): string {
  return `${scope.kind}:${scope.value}`;
}

export function scopeLabel(scope: Scope): string {
  if (scope.kind === "folder") return FOLDER_LABELS[scope.value as FolderId] ?? "Notas";
  if (scope.kind === "kind") return KIND_LABELS[scope.value as NoteKind] ?? "Notas";
  return "Todas as notas";
}

export function matchesScope(note: Note, scope: Scope): boolean {
  if (scope.kind === "folder") return note.folder === scope.value;
  if (scope.kind === "kind") return note.kind === scope.value;
  return true;
}

export function filterAndSort(
  notes: Note[],
  options: {
    scope?: Scope;
    query?: string;
    toPlainText?: (value: string) => string;
  }
): Note[] {
  const scope = options.scope ?? ALL_SCOPE;
  const query = String(options.query ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  const toPlainText = options.toPlainText ?? ((value: string) => String(value ?? ""));

  return notes
    .filter((note) => matchesScope(note, scope))
    .filter((note) => {
      if (!query) return true;
      const searchable = `${note.title ?? ""} ${toPlainText(note.content)}`.toLocaleLowerCase(
        "pt-BR"
      );
      return searchable.includes(query);
    })
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export function hasMeaningfulContent(
  input: { title?: string; content?: string; connections?: unknown },
  toPlainText: (value: string) => string
): boolean {
  return Boolean(
    input.title?.trim() ||
      toPlainText(input.content ?? "") ||
      normalizeConnections(input.connections).length
  );
}
