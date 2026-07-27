/**
 * A coleção de notas e o rascunho em edição.
 *
 * Concentra persistência, autosave e navegação entre notas. Não conhece
 * retenção nem backup: quem precisa cruzar as duas coisas compõe os hooks no
 * nível de cima.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import {
  ALL_SCOPE,
  countByFolder,
  countByKind,
  createConnectionCounts,
  createId,
  createNoteRecord,
  filterAndSort,
  findRelations,
  findTodaysDaily,
  hasMeaningfulContent,
  mergeNote,
  resolvePersistedStatus,
  type Relation,
  type FolderId,
  type Note,
  type NoteKind,
  type Scope,
  type TemplateId
} from "@/domain/notes";
import { findTemplate } from "@/domain/templates";
import { toPlainText, type NoteSection } from "@/shared/html";
import {
  vaultErrorMessage,
  vaultRepository,
  type NoteIndexRow
} from "@/infrastructure/vaultRepository";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import {
  enqueueNoteIndexing,
  removeNoteFromKnowledgeIndex
} from "@/features/knowledge";
import { createGuidedTopicDraft } from "@/features/onboarding/guidedOnboarding";
import { selectInitialNoteId } from "./noteSession";

const AUTOSAVE_DELAY = 700;
const SESSION_DRAFT_KEY = "hyperzettel-active-draft";

function readSessionDraftId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_DRAFT_KEY);
  } catch {
    return null;
  }
}

function writeSessionDraftId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(SESSION_DRAFT_KEY, id);
    else sessionStorage.removeItem(SESSION_DRAFT_KEY);
  } catch {
    // O editor segue funcional quando o navegador bloqueia sessionStorage.
  }
}

/**
 * O domínio troca título vazio por "Sem título" ao criar o registro. No
 * rascunho isso atrapalha: o campo mostraria o texto em vez do placeholder e
 * `hasMeaningfulContent` consideraria a nota preenchida, disparando autosave
 * de notas em branco. Por isso o título volta a ficar vazio aqui.
 */
function emptyDraft(id = createId()): Note {
  const record = createNoteRecord({
    id,
    title: "",
    content: "",
    folder: "inbox",
    template: "blank"
  });
  return { ...record, title: "" };
}

/**
 * Converte uma linha do índice numa nota "leve": o corpo guarda só o texto puro
 * (para preview e contagem), sem o HTML pesado. O conteúdo completo é carregado
 * sob demanda ao abrir a nota.
 */
function toListNote(row: NoteIndexRow): Note {
  return createNoteRecord({
    id: row.id,
    title: row.title,
    content: row.plainText,
    recallPrompt: row.recallPrompt,
    folder: row.folder,
    kind: row.kind,
    template: row.template,
    status: row.status,
    connections: row.connections,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

/** Versão leve de uma nota já carregada, para guardar na lista sem o HTML. */
function lightNote(note: Note): Note {
  return { ...note, content: toPlainText(note.content) };
}

export interface NotesStore {
  /** A coleção com o rascunho mesclado, para a lista refletir a digitação. */
  notes: Note[];
  /** Só o que está gravado. É a base do modelo de conhecimento. */
  savedNotes: Note[];
  draft: Note;
  currentNote: Note | null;
  visibleNotes: Note[];
  processQueue: Note[];
  connectionCounts: Map<string, number>;
  /** Notas relacionadas, uma vez cada, com a direção marcada. */
  relations: Relation[];
  folderCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  scope: Scope;
  query: string;
  dirty: boolean;
  saving: boolean;
  ready: boolean;
  /** Há mudança externa aguardando uma decisão porque existe rascunho local. */
  externalVaultChange: boolean;
  syncingVault: boolean;
  /** Incrementa a cada carga de nota; o editor usa para repopular o DOM. */
  loadToken: number;

  setScope: (scope: Scope) => void;
  setQuery: (query: string) => void;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
  setRecallPrompt: (prompt: string) => void;
  setFolder: (folder: FolderId) => void;
  setTemplate: (template: TemplateId) => void;
  setKind: (kind: NoteKind) => void;
  addConnection: (noteId: string) => void;
  toggleConnection: (noteId: string) => void;
  setConnectionReason: (noteId: string, reason: string) => void;
  removeConnection: (noteId: string) => void;
  openNote: (id: string, options?: { navigate?: boolean }) => Promise<void>;
  newNote: () => Promise<void>;
  newNoteFromTemplate: (template: TemplateId) => Promise<void>;
  startGuidedTopic: (subject: string) => Promise<void>;
  saveNow: () => Promise<void>;
  persistDraft: () => Promise<Note | null>;
  deleteActiveNote: () => Promise<void>;
  patchNote: (id: string, patch: Partial<Note>) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  splitNote: (id: string, sections: NoteSection[]) => Promise<Note[] | undefined>;
  /** Recarrega tudo do disco. Usado depois de importar um backup. */
  reload: () => Promise<Note[]>;
  /** Preserva o rascunho, quando necessário, e aceita o estado atual do vault. */
  reloadExternalChanges: () => Promise<void>;
  adoptImported: (notes: Note[]) => void;
}

const NotesContext = createContext<NotesStore | null>(null);

export function NotesProvider({ children }: { children: ReactNode }) {
  const { announce } = useAnnouncer();
  const { setView } = useNavigation();

  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState<Note>(() => emptyDraft(readSessionDraftId() ?? undefined));
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [externalVaultChange, setExternalVaultChange] = useState(false);
  const [syncingVault, setSyncingVault] = useState(false);
  const [loadToken, setLoadToken] = useState(0);
  /** Ids que casam com a busca FTS; `null` quando não há busca ativa. */
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);

  // Refs espelham o estado para que timers e handlers de evento leiam o
  // valor atual sem precisar ser recriados a cada render.
  const draftRef = useRef(draft);
  const currentNoteRef = useRef(currentNote);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  const revisionRef = useRef(0);
  const autosaveRef = useRef<number>(0);
  const createdInSessionRef = useRef(true);
  const notesRef = useRef(notes);
  const readyRef = useRef(ready);
  const externalVaultChangeRef = useRef(externalVaultChange);
  const vaultSyncRef = useRef(false);
  const vaultProbeRef = useRef(false);
  const lastVaultProbeRef = useRef(0);
  const preservedDraftCopyRef = useRef<Note | null>(null);

  draftRef.current = draft;
  currentNoteRef.current = currentNote;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  notesRef.current = notes;
  readyRef.current = ready;
  externalVaultChangeRef.current = externalVaultChange;

  const persistNote = useCallback(
    async (
      requestedStatus: "draft" | "saved" = "draft",
      isManual = false
    ): Promise<Note | null> => {
      if (externalVaultChangeRef.current) {
        if (isManual) {
          announce(
            "O vault mudou fora do aplicativo. Preserve o rascunho e recarregue antes de concluir."
          );
        }
        return null;
      }
      if (savingRef.current) {
        // Uma gravação já está em curso; espera terminar antes de decidir.
        await new Promise<void>((resolve) => {
          const wait = () => (savingRef.current ? window.setTimeout(wait, 40) : resolve());
          wait();
        });
        if (dirtyRef.current || isManual) return persistNote(requestedStatus, isManual);
        return currentNoteRef.current;
      }

      const source = draftRef.current;
      if (
        !isManual &&
        !hasMeaningfulContent(
          { title: source.title, content: source.content, connections: source.connections },
          toPlainText
        )
      ) {
        setDirty(false);
        return null;
      }

      const savedRevision = revisionRef.current;
      savingRef.current = true;
      setSaving(true);

      try {
        const now = new Date().toISOString();
        const status = resolvePersistedStatus(
          requestedStatus,
          currentNoteRef.current?.status ?? source.status
        );
        const note = createNoteRecord({
          ...source,
          status,
          createdAt: currentNoteRef.current?.createdAt ?? source.createdAt ?? now,
          updatedAt: now
        });

        await vaultRepository.save(note);
        setCurrentNote(note);
        currentNoteRef.current = note;
        createdInSessionRef.current = false;
        setNotes((previous) => mergeNote(previous, lightNote(note)));
        setDraft((previous) => ({ ...previous, ...note, title: previous.title }));

        if (savedRevision === revisionRef.current) {
          setDirty(false);
        } else {
          window.clearTimeout(autosaveRef.current);
          autosaveRef.current = window.setTimeout(() => void persistNote("draft"), AUTOSAVE_DELAY);
        }

        document.title = `${note.title} · Hyperzettel`;
        if (isManual) {
          announce(
            source.status === "draft"
              ? "Nota concluída e disponível para revisão."
              : "Alterações aplicadas agora."
          );
        }
        enqueueNoteIndexing(note);
        return note;
      } catch (error) {
        console.error(error);
        announce(vaultErrorMessage(error, "Não foi possível atualizar o arquivo da nota."));
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [announce]
  );

  const markDirty = useCallback(() => {
    revisionRef.current += 1;
    preservedDraftCopyRef.current = null;
    setDirty(true);
    window.clearTimeout(autosaveRef.current);
    if (externalVaultChangeRef.current) return;
    autosaveRef.current = window.setTimeout(() => void persistNote("draft"), AUTOSAVE_DELAY);
  }, [persistNote]);

  const openNote = useCallback(
    async (
      id: string,
      options: { updateHistory?: boolean; navigate?: boolean } = {}
    ) => {
      const { updateHistory = true, navigate = true } = options;
      if (!id) return;

      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) {
        const source = draftRef.current;
        const meaningful = hasMeaningfulContent(
          { title: source.title, content: source.content, connections: source.connections },
          toPlainText
        );
        const persisted = await persistNote("draft");
        // Uma divergência no arquivo nunca pode transformar a navegação numa
        // perda silenciosa do rascunho que ainda está apenas no editor.
        if (meaningful && !persisted) return;
      }
      if (id === draftRef.current.id && currentNoteRef.current) {
        // A nota já está carregada; não recarrega (preserva o cursor), mas
        // ainda navega para a tela da nota — senão, clicá-la a partir do Início
        // não fazia nada, porque o `return` pulava o `setView("note")`.
        if (navigate) setView("note");
        if (navigate && updateHistory) history.pushState({ id }, "", `#${id}`);
        return;
      }

      let note: Note | null;
      try {
        note = await vaultRepository.read(id);
      } catch (error) {
        console.error(error);
        announce(vaultErrorMessage(error, "Não foi possível abrir esta nota."));
        return;
      }
      if (!note) {
        announce("Esta nota não está mais disponível.");
        return;
      }

      revisionRef.current = 0;
      createdInSessionRef.current = false;
      setCurrentNote(note);
      currentNoteRef.current = note;
      setDraft({ ...note, title: note.title === "Sem título" ? "" : note.title });
      setDirty(false);
      setLoadToken((token) => token + 1);
      if (navigate) setView("note");
      writeSessionDraftId(id);
      document.title = `${note.title || "Novo Zettel"} · Hyperzettel`;
      if (navigate && updateHistory) history.pushState({ id }, "", `#${id}`);
    },
    [announce, persistNote, setView]
  );

  const newNote = useCallback(
    async (options: { updateHistory?: boolean } = {}) => {
      const { updateHistory = true } = options;
      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) {
        const source = draftRef.current;
        const meaningful = hasMeaningfulContent(
          { title: source.title, content: source.content, connections: source.connections },
          toPlainText
        );
        const persisted = await persistNote("draft");
        if (meaningful && !persisted) return;
      }

      const fresh = emptyDraft();
      revisionRef.current = 0;
      createdInSessionRef.current = true;
      setCurrentNote(null);
      currentNoteRef.current = null;
      setDraft(fresh);
      setDirty(false);
      setLoadToken((token) => token + 1);
      setView("note");
      writeSessionDraftId(fresh.id);
      document.title = "Novo Zettel · Hyperzettel";
      if (updateHistory) history.pushState({ mode: "new" }, "", "#novo");
    },
    [persistNote, setView]
  );

  /**
   * Inicia um vault vazio com uma nota de estrutura sobre um assunto real.
   * O conteúdo nasce como rascunho e o autosave o materializa no vault; assim
   * a primeira experiência produz conhecimento do usuário, não dados de demo.
   */
  const startGuidedTopic = useCallback(
    async (subject: string) => {
      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) {
        const source = draftRef.current;
        const meaningful = hasMeaningfulContent(
          { title: source.title, content: source.content, connections: source.connections },
          toPlainText
        );
        const persisted = await persistNote("draft");
        if (meaningful && !persisted) return;
      }

      const guided = createGuidedTopicDraft(subject);
      const fresh = createNoteRecord({
        id: createId(),
        ...guided,
        status: "draft"
      });

      revisionRef.current = 0;
      createdInSessionRef.current = true;
      setCurrentNote(null);
      currentNoteRef.current = null;
      setDraft(fresh);
      setLoadToken((token) => token + 1);
      setView("note");
      writeSessionDraftId(fresh.id);
      history.pushState({ mode: "guided-start" }, "", "#novo");
      markDirty();
      announce("Mapa inicial criado. Complete o objetivo e registre sua primeira pergunta.");
    },
    [announce, markDirty, persistNote, setView]
  );

  const updateDraft = useCallback(
    (patch: Partial<Note>) => {
      setDraft((previous) => ({ ...previous, ...patch }));
      markDirty();
    },
    [markDirty]
  );

  const setTitle = useCallback((title: string) => updateDraft({ title }), [updateDraft]);
  const setContent = useCallback((content: string) => updateDraft({ content }), [updateDraft]);
  const setRecallPrompt = useCallback(
    (recallPrompt: string) => updateDraft({ recallPrompt: recallPrompt.slice(0, 300) }),
    [updateDraft]
  );
  const setFolder = useCallback((folder: FolderId) => updateDraft({ folder }), [updateDraft]);
  const setTemplate = useCallback(
    (template: TemplateId) => updateDraft({ template }),
    [updateDraft]
  );
  const setKind = useCallback((kind: NoteKind) => updateDraft({ kind }), [updateDraft]);

  /** Cria uma conexão sem o comportamento de alternância usado no seletor. */
  const addConnection = useCallback(
    (noteId: string) => {
      if (
        noteId === draftRef.current.id ||
        draftRef.current.connections.some((connection) => connection.id === noteId)
      ) {
        return;
      }
      setDraft((previous) => ({
        ...previous,
        connections: [...previous.connections, { id: noteId, reason: "" }]
      }));
      markDirty();
      announce("Conexão criada. Explique por que as notas se conectam.");
    },
    [announce, markDirty]
  );

  const toggleConnection = useCallback(
    (noteId: string) => {
      setDraft((previous) => {
        const exists = previous.connections.some((connection) => connection.id === noteId);
        return {
          ...previous,
          connections: exists
            ? previous.connections.filter((connection) => connection.id !== noteId)
            : [...previous.connections, { id: noteId, reason: "" }]
        };
      });
      markDirty();
    },
    [markDirty]
  );

  /** O motivo é editado depois de criada a conexão, e pode ficar vazio. */
  const setConnectionReason = useCallback(
    (noteId: string, reason: string) => {
      setDraft((previous) => ({
        ...previous,
        connections: previous.connections.map((connection) =>
          connection.id === noteId ? { ...connection, reason } : connection
        )
      }));
      markDirty();
    },
    [markDirty]
  );

  const removeConnection = useCallback(
    (noteId: string) => {
      setDraft((previous) => ({
        ...previous,
        connections: previous.connections.filter((connection) => connection.id !== noteId)
      }));
      markDirty();
    },
    [markDirty]
  );

  const saveNow = useCallback(async () => {
    const source = draftRef.current;
    if (
      !hasMeaningfulContent(
        { title: source.title, content: source.content, connections: source.connections },
        toPlainText
      )
    ) {
      announce("Escreva antes de concluir a nota.");
      return;
    }

    window.clearTimeout(autosaveRef.current);
    await persistNote("saved", true);
  }, [announce, persistNote]);

  /** Grava o rascunho se houver pendência. Usado antes de ações externas. */
  const persistDraft = useCallback(async () => {
    if (!dirtyRef.current) return currentNoteRef.current;
    return persistNote("draft");
  }, [persistNote]);

  const deleteActiveNote = useCallback(async () => {
    window.clearTimeout(autosaveRef.current);
    const id = draftRef.current.id;
    if (!createdInSessionRef.current || currentNoteRef.current) {
      try {
        await vaultRepository.remove(id);
        await removeNoteFromKnowledgeIndex(id);
      } catch (error) {
        console.error(error);
        announce(vaultErrorMessage(error, "Não foi possível excluir esta nota."));
        return;
      }
    }
    setNotes((previous) => previous.filter((note) => note.id !== id));
    announce("Nota excluída.");
    await newNote();
  }, [announce, newNote]);

  /** Cria uma nota já preenchida com a estrutura do modelo escolhido. */
  const newNoteFromTemplate = useCallback(
    async (templateId: TemplateId) => {
      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) {
        const source = draftRef.current;
        const meaningful = hasMeaningfulContent(
          { title: source.title, content: source.content, connections: source.connections },
          toPlainText
        );
        const persisted = await persistNote("draft");
        if (meaningful && !persisted) return;
      }

      const template = findTemplate(templateId);

      // A nota diária é uma por dia: se a de hoje já existe, abre em vez de
      // duplicar (A1 do design review).
      if (templateId === "daily" && template.title) {
        const existing = findTodaysDaily(notesRef.current, template.title());
        if (existing) {
          await openNote(existing.id);
          announce("Abrindo a nota diária de hoje.");
          return;
        }
      }

      const fresh = createNoteRecord({
        id: createId(),
        title: template.title?.() ?? "",
        content: template.content,
        folder: template.folder,
        kind: template.kind,
        template: template.id
      });

      revisionRef.current = 0;
      createdInSessionRef.current = true;
      setCurrentNote(null);
      currentNoteRef.current = null;
      setDraft({ ...fresh, title: template.title?.() ?? "" });
      setLoadToken((token) => token + 1);
      setView("note");
      writeSessionDraftId(fresh.id);
      history.pushState({ mode: "new" }, "", "#novo");

      // O modelo já traz conteúdo real, então a nota nasce suja: sem isto o
      // autosave nunca dispara e a estrutura aplicada se perde ao trocar de nota.
      markDirty();
      announce(`Modelo aplicado: ${template.name}.`);
    },
    [announce, markDirty, openNote, persistNote, setView]
  );

  /**
   * Aplica e persiste uma mudança em qualquer nota, sem passar pelo rascunho
   * ativo. O fluxo de processamento trabalha sobre notas da fila, que não são
   * necessariamente a que está aberta no editor.
   */
  const patchNote = useCallback(async (id: string, patch: Partial<Note>) => {
    const stored = await vaultRepository.read(id);
    if (!stored) return;

    const updated = createNoteRecord({
      ...stored,
      ...patch,
      status: "saved",
      updatedAt: new Date().toISOString()
    });
    await vaultRepository.save(updated);
    enqueueNoteIndexing(updated);
    setNotes((previous) => mergeNote(previous, lightNote(updated)));

    // Se a nota alterada é a que está aberta, o rascunho acompanha.
    if (draftRef.current.id === id) {
      setCurrentNote(updated);
      currentNoteRef.current = updated;
      setDraft((previous) => ({ ...updated, title: previous.title }));
    }
  }, []);

  const removeNote = useCallback(
    async (id: string) => {
      await vaultRepository.remove(id);
      await removeNoteFromKnowledgeIndex(id);
      setNotes((previous) => previous.filter((note) => note.id !== id));
      if (draftRef.current.id === id) await newNote();
    },
    [newNote]
  );

  /**
   * Extrai seções de uma nota em notas permanentes independentes, cada uma
   * conectada de volta à origem com o motivo já preenchido. É a ação da
   * pergunta "existe mais de uma ideia?".
   */
  const splitNote = useCallback(
    async (id: string, sections: NoteSection[]) => {
      const source = await vaultRepository.read(id);
      if (!source || !sections.length) return;

      const created = sections.map((section) =>
        createNoteRecord({
          id: createId(),
          title: section.title,
          content: section.html,
          folder: "resources",
          kind: "permanent",
          template: "concept",
          status: "saved",
          connections: [{ id: source.id, reason: `Extraída de “${source.title}”.` }]
        })
      );

      await vaultRepository.saveMany(created);
      created.forEach(enqueueNoteIndexing);
      setNotes((previous) => created.map(lightNote).reduce(mergeNote, previous));
      announce(
        `${created.length} ${created.length === 1 ? "nota criada" : "notas criadas"} a partir das seções.`
      );
      return created;
    },
    [announce]
  );

  const reload = useCallback(async () => {
    const all = (await vaultRepository.list()).map(toListNote);
    setNotes(all);
    return all;
  }, []);

  /**
   * Aceita o estado externo sem perder uma edição local. Um rascunho sujo
   * ganha nova identidade antes da reindexação; depois essa cópia é reaberta.
   */
  const reloadExternalChanges = useCallback(async () => {
    if (vaultSyncRef.current) return;
    vaultSyncRef.current = true;
    setSyncingVault(true);
    window.clearTimeout(autosaveRef.current);

    try {
      let targetId = currentNoteRef.current?.id ?? null;
      let preserved: Note | null = null;
      const source = draftRef.current;

      // `dirty` é a autoridade aqui: apagar todo o conteúdo também é uma
      // edição legítima e precisa sobreviver, embora o resultado pareça vazio.
      if (dirtyRef.current) {
        preserved = preservedDraftCopyRef.current;
        if (!preserved) {
          const now = new Date().toISOString();
          preserved = createNoteRecord({
            ...source,
            id: createId(),
            title: `${source.title.trim() || "Sem título"} (cópia local)`,
            status: "draft",
            createdAt: now,
            updatedAt: now
          });
          await vaultRepository.save(preserved);
          preservedDraftCopyRef.current = preserved;
          enqueueNoteIndexing(preserved);
        }
        targetId = preserved.id;
      }

      const report = await vaultRepository.reconcileIndexWithVault();
      const all = (await vaultRepository.list()).map(toListNote);
      const restored = targetId ? await vaultRepository.read(targetId) : null;

      setNotes(all);
      revisionRef.current = 0;
      setDirty(false);
      if (restored) {
        setCurrentNote(restored);
        currentNoteRef.current = restored;
        createdInSessionRef.current = false;
        setDraft({
          ...restored,
          title: restored.title === "Sem título" ? "" : restored.title
        });
        writeSessionDraftId(restored.id);
        document.title = `${restored.title} · Hyperzettel`;
        setLoadToken((token) => token + 1);
      } else if (targetId) {
        const fresh = emptyDraft();
        setCurrentNote(null);
        currentNoteRef.current = null;
        createdInSessionRef.current = true;
        setDraft(fresh);
        writeSessionDraftId(fresh.id);
        document.title = "Novo Zettel · Hyperzettel";
        setLoadToken((token) => token + 1);
      }

      externalVaultChangeRef.current = false;
      preservedDraftCopyRef.current = null;
      setExternalVaultChange(false);
      if (preserved) {
        announce(`Rascunho preservado como “${preserved.title}”. Vault recarregado.`);
      } else if (report?.issues.length) {
        announce(
          `Vault recarregado; ${report.issues.length} conflito(s) permanecem isolados na Central do Vault.`
        );
      } else {
        announce("Mudanças externas carregadas.");
      }
    } catch (error) {
      console.error(error);
      externalVaultChangeRef.current = true;
      setExternalVaultChange(true);
      announce(vaultErrorMessage(error, "Não foi possível recarregar as mudanças externas."));
    } finally {
      vaultSyncRef.current = false;
      setSyncingVault(false);
    }
  }, [announce]);

  /** Reabre no editor uma nota que veio do backup, se for a que está aberta. */
  const adoptImported = useCallback((imported: Note[]) => {
    imported.forEach(enqueueNoteIndexing);
    const match = imported.find((note) => note.id === draftRef.current.id);
    if (match) {
      setCurrentNote(match);
      currentNoteRef.current = match;
      setDraft({ ...match, title: match.title === "Sem título" ? "" : match.title });
      setLoadToken((token) => token + 1);
    }
    setDirty(false);
  }, []);

  // Carga inicial: abre o banco e restaura a sessão.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Reconcilia nomes físicos e índice sem ler o corpo pesado quando nada
        // mudou. Arquivos adicionados, removidos ou renomeados fora do app
        // disparam a reconstrução a partir do vault (a fonte da verdade).
        const report = await vaultRepository.reconcileIndexWithVault();
        if (report?.issues.length) {
          const names = report.issues
            .flatMap((issue) => issue.fileNames)
            .slice(0, 3)
            .join(", ");
          announce(
            `${report.issues.length} conflito(s) de identidade não foram indexados: ${names}. ` +
              "Revise os arquivos com hz:id ausente ou duplicado."
          );
        }
        const all = (await vaultRepository.list()).map(toListNote);
        if (cancelled) return;

        setNotes(all);

        const hashId = location.hash.replace(/^#/, "");
        const sessionId = readSessionDraftId();
        const targetId = selectInitialNoteId(all, hashId, sessionId);
        if (sessionId && !all.some((note) => note.id === sessionId)) {
          writeSessionDraftId(null);
        }
        const restored = targetId ? await vaultRepository.read(targetId) : null;

        if (!cancelled && restored) {
          setCurrentNote(restored);
          currentNoteRef.current = restored;
          createdInSessionRef.current = false;
          setDraft({
            ...restored,
            title: restored.title === "Sem título" ? "" : restored.title
          });
          setLoadToken((token) => token + 1);
          document.title = `${restored.title} · Hyperzettel`;
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          announce(vaultErrorMessage(error, "O armazenamento local não pôde ser iniciado."));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [announce]);

  // Ao retomar a janela, compara fingerprints sem tocar no índice. Mudanças
  // limpas são carregadas; com rascunho pendente, o autosave é pausado até a
  // pessoa preservar a edição como cópia.
  useEffect(() => {
    const probe = async () => {
      if (
        !readyRef.current ||
        document.visibilityState === "hidden" ||
        savingRef.current ||
        vaultProbeRef.current ||
        vaultSyncRef.current
      ) {
        return;
      }
      const now = Date.now();
      if (now - lastVaultProbeRef.current < 1_000) return;
      lastVaultProbeRef.current = now;
      vaultProbeRef.current = true;
      try {
        if (!(await vaultRepository.hasExternalChanges())) return;
        // Uma gravação iniciada depois do probe pode produzir divergência
        // transitória entre arquivo e índice; não a rotula como edição externa.
        if (savingRef.current) return;
        if (dirtyRef.current) {
          window.clearTimeout(autosaveRef.current);
          if (!externalVaultChangeRef.current) {
            externalVaultChangeRef.current = true;
            setExternalVaultChange(true);
            announce(
              "O vault mudou fora do aplicativo. Seu rascunho foi pausado e pode ser preservado como cópia."
            );
          }
          return;
        }
        await reloadExternalChanges();
      } catch (error) {
        console.error(error);
        announce(vaultErrorMessage(error, "Não foi possível verificar mudanças no vault."));
      } finally {
        vaultProbeRef.current = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void probe();
    };
    window.addEventListener("focus", probe);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", probe);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [announce, reloadExternalChanges]);

  // Navegação de voltar/avançar do navegador.
  useEffect(() => {
    const onPopState = () => {
      const hashId = location.hash.replace(/^#/, "");
      if (hashId && hashId !== "novo") void openNote(hashId, { updateHistory: false });
      else void newNote({ updateHistory: false });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [newNote, openNote]);

  // Aviso ao sair com alterações pendentes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => () => window.clearTimeout(autosaveRef.current), []);

  // Busca no índice FTS (SQLite), com debounce. `searchIds = null` desliga o
  // filtro; caso contrário a lista mostra só os ids que casaram.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setSearchIds(null);
      return;
    }
    let active = true;
    const handle = window.setTimeout(() => {
      void vaultRepository.search(term).then((ids) => {
        if (active) setSearchIds(new Set(ids));
      });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  /**
   * A lista precisa mostrar o rascunho em edição junto das notas gravadas,
   * para que título e pasta reflitam a digitação em tempo real.
   */
  const notesWithDraft = useMemo(() => {
    const meaningful = hasMeaningfulContent(
      { title: draft.title, content: draft.content, connections: draft.connections },
      toPlainText
    );
    if (!currentNote && !meaningful) return notes;
    return mergeNote(notes, draft);
  }, [notes, draft, currentNote]);

  const visibleNotes = useMemo(() => {
    // Escopo + ordenação em memória; a busca textual vem do índice FTS.
    const scoped = filterAndSort(notesWithDraft, { scope });
    if (searchIds === null) return scoped;
    return scoped.filter((note) => searchIds.has(note.id));
  }, [notesWithDraft, scope, searchIds]);

  const connectionCounts = useMemo(
    () => createConnectionCounts(notesWithDraft),
    [notesWithDraft]
  );
  const relations = useMemo(
    () => findRelations(notesWithDraft, draft.id),
    [notesWithDraft, draft.id]
  );
  const folderCounts = useMemo(() => countByFolder(notesWithDraft), [notesWithDraft]);
  const kindCounts = useMemo(() => countByKind(notesWithDraft), [notesWithDraft]);

  /*
   * A fila é o que está na entrada mais o que já saiu dela mas continua
   * fugaz — o fluxo do Zettelkasten processa ideias cruas, não pastas.
   */
  const processQueue = useMemo(
    () =>
      notes
        .filter((note) => note.folder === "inbox" || note.kind === "fleeting")
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
    [notes]
  );

  const value = useMemo<NotesStore>(
    () => ({
      notes: notesWithDraft,
      savedNotes: notes,
      draft,
      currentNote,
      visibleNotes,
      processQueue,
      connectionCounts,
      relations,
      folderCounts,
      kindCounts,
      scope,
      query,
      dirty,
      saving,
      ready,
      externalVaultChange,
      syncingVault,
      loadToken,
      setScope,
      setQuery,
      setTitle,
      setContent,
      setRecallPrompt,
      setFolder,
      setTemplate,
      setKind,
      addConnection,
      toggleConnection,
      setConnectionReason,
      removeConnection,
      openNote: (id: string, options?: { navigate?: boolean }) => openNote(id, options),
      newNote: () => newNote(),
      newNoteFromTemplate,
      startGuidedTopic,
      saveNow,
      persistDraft,
      deleteActiveNote,
      patchNote,
      removeNote,
      splitNote,
      reload,
      reloadExternalChanges,
      adoptImported
    }),
    [
      notesWithDraft, notes, draft, currentNote, visibleNotes, processQueue,
      connectionCounts, relations, folderCounts, kindCounts, scope, query,
      dirty, saving, ready, externalVaultChange, syncingVault, loadToken,
      setTitle, setContent, setRecallPrompt, setFolder,
      setTemplate, setKind, addConnection, toggleConnection, setConnectionReason,
      removeConnection, openNote, newNote, newNoteFromTemplate, startGuidedTopic, saveNow,
      persistDraft, deleteActiveNote, patchNote, removeNote, splitNote,
      reload, reloadExternalChanges, adoptImported
    ]
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesStore {
  const context = useContext(NotesContext);
  if (!context) throw new Error("useNotes precisa estar dentro de <NotesProvider>.");
  return context;
}
