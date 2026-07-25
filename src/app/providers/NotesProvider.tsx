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
import { vaultRepository, type NoteIndexRow } from "@/infrastructure/vaultRepository";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useNavigation } from "@/app/providers/NavigationProvider";
import {
  enqueueNoteIndexing,
  removeNoteFromKnowledgeIndex
} from "@/features/knowledge";

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
  /** Incrementa a cada carga de nota; o editor usa para repopular o DOM. */
  loadToken: number;

  setScope: (scope: Scope) => void;
  setQuery: (query: string) => void;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
  setFolder: (folder: FolderId) => void;
  setTemplate: (template: TemplateId) => void;
  setKind: (kind: NoteKind) => void;
  addConnection: (noteId: string) => void;
  toggleConnection: (noteId: string) => void;
  setConnectionReason: (noteId: string, reason: string) => void;
  removeConnection: (noteId: string) => void;
  openNote: (id: string) => Promise<void>;
  newNote: () => Promise<void>;
  newNoteFromTemplate: (template: TemplateId) => Promise<void>;
  saveNow: () => Promise<void>;
  persistDraft: () => Promise<Note | null>;
  deleteActiveNote: () => Promise<void>;
  patchNote: (id: string, patch: Partial<Note>) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  splitNote: (id: string, sections: NoteSection[]) => Promise<Note[] | undefined>;
  /** Recarrega tudo do disco. Usado depois de importar um backup. */
  reload: () => Promise<Note[]>;
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

  draftRef.current = draft;
  currentNoteRef.current = currentNote;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  notesRef.current = notes;

  const persistNote = useCallback(
    async (
      requestedStatus: "draft" | "saved" = "draft",
      isManual = false
    ): Promise<Note | null> => {
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
              ? "Rascunho concluído e salvo neste dispositivo."
              : "Nota salva neste dispositivo."
          );
        }
        enqueueNoteIndexing(note);
        return note;
      } catch (error) {
        console.error(error);
        announce("Não foi possível salvar a nota.");
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
    setDirty(true);
    window.clearTimeout(autosaveRef.current);
    autosaveRef.current = window.setTimeout(() => void persistNote("draft"), AUTOSAVE_DELAY);
  }, [persistNote]);

  const openNote = useCallback(
    async (id: string, options: { updateHistory?: boolean } = {}) => {
      const { updateHistory = true } = options;
      if (!id) return;

      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) await persistNote("draft");
      if (id === draftRef.current.id && currentNoteRef.current) return;

      const note = await vaultRepository.read(id);
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
      setView("note");
      writeSessionDraftId(id);
      document.title = `${note.title || "Novo Zettel"} · Hyperzettel`;
      if (updateHistory) history.pushState({ id }, "", `#${id}`);
    },
    [announce, persistNote, setView]
  );

  const newNote = useCallback(
    async (options: { updateHistory?: boolean } = {}) => {
      const { updateHistory = true } = options;
      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) await persistNote("draft");

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

  const updateDraft = useCallback(
    (patch: Partial<Note>) => {
      setDraft((previous) => ({ ...previous, ...patch }));
      markDirty();
    },
    [markDirty]
  );

  const setTitle = useCallback((title: string) => updateDraft({ title }), [updateDraft]);
  const setContent = useCallback((content: string) => updateDraft({ content }), [updateDraft]);
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
      announce("Comece a escrever antes de concluir o rascunho.");
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
      await vaultRepository.remove(id);
      await removeNoteFromKnowledgeIndex(id);
    }
    setNotes((previous) => previous.filter((note) => note.id !== id));
    announce("Nota excluída.");
    await newNote();
  }, [announce, newNote]);

  /** Cria uma nota já preenchida com a estrutura do modelo escolhido. */
  const newNoteFromTemplate = useCallback(
    async (templateId: TemplateId) => {
      window.clearTimeout(autosaveRef.current);
      if (dirtyRef.current) await persistNote("draft");

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
        // Reconcilia o índice com os arquivos do vault (a fonte da verdade): se
        // o índice está vazio mas há arquivos — vault sincronizado para outra
        // máquina, ou índice apagado —, reconstrói a partir deles.
        if ((await vaultRepository.list()).length === 0) {
          await vaultRepository.reindexFromVault();
        }
        const all = (await vaultRepository.list()).map(toListNote);
        if (cancelled) return;

        setNotes(all);

        const hashId = location.hash.replace(/^#/, "");
        const targetId =
          hashId && hashId !== "novo" ? hashId : (readSessionDraftId() ?? draftRef.current.id);
        const restored = await vaultRepository.read(targetId);

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
        if (!cancelled) announce("O armazenamento local não pôde ser iniciado.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [announce]);

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
      loadToken,
      setScope,
      setQuery,
      setTitle,
      setContent,
      setFolder,
      setTemplate,
      setKind,
      addConnection,
      toggleConnection,
      setConnectionReason,
      removeConnection,
      openNote: (id: string) => openNote(id),
      newNote: () => newNote(),
      newNoteFromTemplate,
      saveNow,
      persistDraft,
      deleteActiveNote,
      patchNote,
      removeNote,
      splitNote,
      reload,
      adoptImported
    }),
    [
      notesWithDraft, notes, draft, currentNote, visibleNotes, processQueue,
      connectionCounts, relations, folderCounts, kindCounts, scope, query,
      dirty, saving, ready, loadToken, setTitle, setContent, setFolder,
      setTemplate, setKind, addConnection, toggleConnection, setConnectionReason,
      removeConnection, openNote, newNote, newNoteFromTemplate, saveNow,
      persistDraft, deleteActiveNote, patchNote, removeNote, splitNote,
      reload, adoptImported
    ]
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesStore {
  const context = useContext(NotesContext);
  if (!context) throw new Error("useNotes precisa estar dentro de <NotesProvider>.");
  return context;
}
