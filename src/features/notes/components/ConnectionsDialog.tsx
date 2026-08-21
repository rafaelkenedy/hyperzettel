/**
 * Seletor de conexões. Porte de `scripts/ui/connections-controller.js`:
 * busca sobre as demais notas, marcação por checkbox e remoção pelas tags.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input
} from "@relume_io/relume-ui";
import { Search, X } from "lucide-react";

import { useNotes } from "@/app/providers/NotesProvider";
import { ALL_SCOPE, FOLDER_LABELS, filterAndSort } from "@/domain/notes";
import { formatDate, toPlainText } from "@/shared/html";

export function ConnectionsDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notes = useNotes();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const available = useMemo(
    () =>
      filterAndSort(
        notes.notes.filter((note) => note.id !== notes.draft.id),
        { scope: ALL_SCOPE, query: search, toPlainText }
      ),
    [notes.notes, notes.draft.id, search]
  );

  const hasOtherNotes = notes.notes.some((note) => note.id !== notes.draft.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* O DialogContent do Relume não define fundo próprio; sem isto o
          overlay atravessa e o conteúdo fica ilegível. */}
      <DialogContent
        closeIconPosition="inside"
        closeIconClassName="hidden"
        overlayClassName="bg-black/40"
        className="flex max-h-[80vh] max-w-lg flex-col gap-0 overflow-hidden rounded-lg border border-border-primary bg-background-primary p-0 shadow-pop"
      >
        <DialogHeader className="border-b border-border-primary px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1.5">
              <DialogTitle className="text-md">Conectar esta nota</DialogTitle>
              <DialogDescription className="text-xs text-text-tertiary">
                As conexões são bidirecionais: a outra nota também passa a listar esta.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Fechar"
              className="-mr-1 -mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-text-secondary transition-colors hover:bg-hz-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hz-accent"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        </DialogHeader>

        <div className="shrink-0 border-b border-border-primary px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary"
              strokeWidth={1.75}
            />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar entre as notas…"
              aria-label="Buscar notas para conectar"
              className="h-9 rounded-md border-border-primary bg-background-secondary pl-8 text-xs focus:border-hz-accent focus:bg-background-primary"
            />
          </div>
          <p className="mt-2 text-2xs text-text-secondary">
            {available.length} {available.length === 1 ? "nota disponível" : "notas disponíveis"} ·{" "}
            {notes.draft.connections.length} selecionada
            {notes.draft.connections.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="hz-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {available.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[13px] font-semibold">
                {hasOtherNotes ? "Nenhuma nota encontrada" : "Seu conhecimento começa aqui"}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {hasOtherNotes
                  ? "Tente outro termo de busca."
                  : "Depois de criar outras notas, elas aparecerão aqui para serem conectadas."}
              </p>
            </div>
          ) : (
            available.map((note) => {
              const connection = notes.draft.connections.find((item) => item.id === note.id);
              const checked = Boolean(connection);
              return (
                <div key={note.id} className="rounded-md px-1">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-background-secondary">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => notes.toggleConnection(note.id)}
                      aria-label={`Conectar com ${note.title || "Sem título"}`}
                      className="mt-0.5 size-4 rounded border-border-tertiary data-[state=checked]:border-hz-accent data-[state=checked]:bg-hz-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {note.title || "Sem título"}
                      </span>
                      <span className="mt-0.5 block truncate text-2xs text-text-secondary">
                        {FOLDER_LABELS[note.folder]} · {formatDate(note.updatedAt)}
                      </span>
                    </span>
                  </label>

                  {/* O motivo aparece assim que a conexão é criada: é o
                      momento em que a explicação ainda está fresca. */}
                  {checked ? (
                    <div className="mb-1 ml-9 mr-2">
                      <Input
                        autoFocus
                        value={connection?.reason ?? ""}
                        onChange={(event) =>
                          notes.setConnectionReason(note.id, event.target.value)
                        }
                        placeholder="Por que estas notas se conectam?"
                        aria-label={`Motivo da conexão com ${note.title || "Sem título"}`}
                        className="h-7 rounded-md border-border-primary bg-background-secondary px-2 text-2xs focus:border-hz-accent focus:bg-background-primary"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
