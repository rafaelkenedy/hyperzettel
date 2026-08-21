/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { NotesProvider, useNotes } from "./NotesProvider";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  setView: vi.fn(),
  reconcile: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  hasExternalChanges: vi.fn(),
  save: vi.fn(),
  enqueue: vi.fn(),
  removeFromKnowledge: vi.fn()
}));

vi.mock("@/app/providers/AnnouncerProvider", () => ({
  useAnnouncer: () => ({ announce: mocks.announce })
}));

vi.mock("@/app/providers/NavigationProvider", () => ({
  useNavigation: () => ({ setView: mocks.setView })
}));

vi.mock("@/features/knowledge", () => ({
  enqueueNoteIndexing: mocks.enqueue,
  removeNoteFromKnowledgeIndex: mocks.removeFromKnowledge
}));

vi.mock("@/infrastructure/vaultRepository", () => ({
  vaultErrorMessage: (_error: unknown, fallback: string) => fallback,
  vaultRepository: {
    reconcileIndexWithVault: mocks.reconcile,
    list: mocks.list,
    read: mocks.read,
    hasExternalChanges: mocks.hasExternalChanges,
    save: mocks.save
  }
}));

function Harness() {
  const notes = useNotes();
  return (
    <div>
      <span data-testid="ready">{String(notes.ready)}</span>
      <span data-testid="external">{String(notes.externalVaultChange)}</span>
      <span data-testid="draft-id">{notes.draft.id}</span>
      <span data-testid="draft-title">{notes.draft.title}</span>
      <span data-testid="draft-kind">{notes.draft.kind}</span>
      <span data-testid="draft-template">{notes.draft.template}</span>
      <button type="button" onClick={() => notes.setTitle("Meu rascunho")}>
        Editar
      </button>
      <button type="button" onClick={() => void notes.reloadExternalChanges()}>
        Recarregar
      </button>
      <button type="button" onClick={() => void notes.newNoteFromTemplate("study")}>
        Criar nota de estudo
      </button>
      <button type="button" onClick={() => void notes.saveNow()}>
        Concluir nota
      </button>
    </div>
  );
}

describe("sincronização do vault durante a sessão", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    sessionStorage.clear();
    location.hash = "";
    mocks.reconcile.mockResolvedValue(null);
    mocks.list.mockResolvedValue([]);
    mocks.read.mockResolvedValue(null);
    mocks.hasExternalChanges.mockResolvedValue(false);
    mocks.save.mockResolvedValue(undefined);
    mocks.removeFromKnowledge.mockResolvedValue(undefined);
  });

  test("reconcilia automaticamente uma mudança externa quando o editor está limpo", async () => {
    render(
      <NotesProvider>
        <Harness />
      </NotesProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    mocks.hasExternalChanges.mockResolvedValue(true);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("external").textContent).toBe("false");
    expect(mocks.announce).toHaveBeenCalledWith("Mudanças externas carregadas.");
  });

  test("aplica a estrutura permanente do modelo de estudo", async () => {
    render(
      <NotesProvider>
        <Harness />
      </NotesProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Criar nota de estudo" }));

    expect(screen.getByTestId("draft-kind").textContent).toBe("permanent");
    expect(screen.getByTestId("draft-template").textContent).toBe("study");
    expect(mocks.setView).toHaveBeenCalledWith("note");
    expect(mocks.announce).toHaveBeenCalledWith("Modelo aplicado: Nota de estudo.");
  });

  test("protege o modelo no autosave sem concluí-lo como conteúdo autoral", async () => {
    render(
      <NotesProvider>
        <Harness />
      </NotesProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Criar nota de estudo" }));
    await waitFor(() => expect(screen.getByTestId("draft-template").textContent).toBe("study"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      template: "study",
      status: "draft"
    });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    mocks.announce.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Concluir nota" }));

    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.announce).toHaveBeenCalledWith(
      "Substitua as instruções do modelo pelo conteúdo da nota antes de concluir."
    );
  });

  test("pausa o rascunho e o preserva com nova identidade antes de recarregar", async () => {
    let preserved:
      | {
          id: string;
          title: string;
          content: string;
        }
      | undefined;
    mocks.save.mockImplementation(async (note) => {
      preserved = note;
    });
    mocks.read.mockImplementation(async (id: string) =>
      preserved?.id === id ? preserved : null
    );

    render(
      <NotesProvider>
        <Harness />
      </NotesProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    const originalId = screen.getByTestId("draft-id").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    mocks.hasExternalChanges.mockResolvedValue(true);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByTestId("external").textContent).toBe("true"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.announce).toHaveBeenCalledWith(
      "O vault mudou fora do aplicativo. Seu rascunho foi pausado e pode ser preservado como cópia."
    );

    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(preserved).toMatchObject({
      title: "Meu rascunho (cópia local)",
      status: "draft"
    });
    expect(preserved?.id).not.toBe(originalId);
    await waitFor(() => expect(screen.getByTestId("external").textContent).toBe("false"));
    expect(screen.getByTestId("draft-id").textContent).toBe(preserved?.id);
    expect(mocks.announce).toHaveBeenCalledWith(
      "Rascunho preservado como “Meu rascunho (cópia local)”. Vault recarregado."
    );
  });

  test("uma nova tentativa reutiliza a cópia já salva se a reconciliação falhar", async () => {
    let preserved: { id: string; title: string } | undefined;
    mocks.save.mockImplementation(async (note) => {
      preserved = note;
    });
    mocks.read.mockImplementation(async (id: string) =>
      preserved?.id === id ? preserved : null
    );
    mocks.reconcile
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("índice ocupado"))
      .mockResolvedValueOnce(null);

    render(
      <NotesProvider>
        <Harness />
      </NotesProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    mocks.hasExternalChanges.mockResolvedValue(true);
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.getByTestId("external").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() =>
      expect(mocks.announce).toHaveBeenCalledWith(
        "Não foi possível recarregar as mudanças externas."
      )
    );
    expect(screen.getByTestId("external").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.getByTestId("external").textContent).toBe("false"));
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
