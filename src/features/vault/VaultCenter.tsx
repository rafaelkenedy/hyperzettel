import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@relume_io/relume-ui";
import {
  Database,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";

import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useNotes } from "@/app/providers/NotesProvider";
import { enqueueNoteIndexing } from "@/features/knowledge";
import {
  vaultErrorMessage,
  vaultRepository,
  type VaultInfo,
  type VaultInspection,
  type VaultIntegrityIssue
} from "@/infrastructure/vaultRepository";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function issueLabel(issue: VaultIntegrityIssue): string {
  return issue.code === "missing_id"
    ? "Arquivo externo sem identidade"
    : "Identidade duplicada";
}

export function VaultCenter({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notes = useNotes();
  const { announce } = useAnnouncer();
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [inspection, setInspection] = useState<VaultInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setFeedback("");
    try {
      const [nextInfo, nextInspection] = await Promise.all([
        vaultRepository.getInfo(),
        vaultRepository.inspectVault()
      ]);
      setInfo(nextInfo);
      setInspection(nextInspection);
    } catch (error) {
      console.error(error);
      const message = vaultErrorMessage(error, "Não foi possível verificar o vault.");
      setFeedback(message);
      announce(message);
    } finally {
      setBusy(false);
    }
  }, [announce]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const missingIds = useMemo(
    () => inspection?.issues.filter((issue) => issue.code === "missing_id") ?? [],
    [inspection]
  );
  const duplicateIds = useMemo(
    () => inspection?.issues.filter((issue) => issue.code === "duplicate_id") ?? [],
    [inspection]
  );

  const adopt = async (fileName: string) => {
    setAdopting(fileName);
    setFeedback("");
    try {
      const note = await vaultRepository.adoptDocument(fileName);
      enqueueNoteIndexing(note);
      await notes.reload();
      await refresh();
      const message = `“${fileName}” foi adotado como nota na Entrada.`;
      setFeedback(message);
      announce(message);
    } catch (error) {
      console.error(error);
      const message = vaultErrorMessage(error, "Não foi possível adotar o arquivo.");
      setFeedback(message);
      announce(message);
    } finally {
      setAdopting(null);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setFeedback("");
    try {
      const report = await vaultRepository.reindexFromVault();
      await notes.reload();
      await refresh();
      const message = report.issues.length
        ? `Índice reconstruído; ${report.issues.length} conflito(s) continuam isolados.`
        : `Índice reconstruído com ${report.indexed} ${report.indexed === 1 ? "nota" : "notas"}.`;
      setFeedback(message);
      announce(message);
    } catch (error) {
      console.error(error);
      const message = vaultErrorMessage(error, "Não foi possível reconstruir o índice.");
      setFeedback(message);
      announce(message);
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async () => {
    try {
      await vaultRepository.openFolder();
      announce("Pasta do vault aberta.");
    } catch (error) {
      console.error(error);
      const message = vaultErrorMessage(error, "Não foi possível abrir a pasta do vault.");
      setFeedback(message);
      announce(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] !max-w-[48rem] flex-col gap-0 overflow-hidden rounded-xl border border-border-primary bg-background-primary p-0 shadow-pop">
        <DialogHeader className="border-b border-border-primary px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-md">
            <Database className="size-4 text-text-secondary" strokeWidth={1.75} />
            Central do Vault
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-text-tertiary">
            Seus arquivos HTML são a fonte da verdade. O índice pode ser verificado e
            reconstruído a partir deles.
          </DialogDescription>
        </DialogHeader>

        <div className="hz-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section className="rounded-xl border border-border-primary bg-background-secondary p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-medium uppercase tracking-[0.08em] text-text-secondary">
                  Local dos arquivos
                </p>
                <p
                  className="mt-1 break-all font-mono text-xs leading-relaxed text-text-primary"
                  title={info?.rootPath}
                >
                  {info?.rootPath ?? "Carregando…"}
                </p>
                {info ? (
                  <p className="mt-2 text-2xs text-text-secondary">
                    {info.fileCount} {info.fileCount === 1 ? "arquivo HTML" : "arquivos HTML"} ·{" "}
                    {formatBytes(info.totalBytes)}
                  </p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 gap-1.5 border-border-tertiary bg-background-primary text-xs"
                onClick={() => void openFolder()}
                disabled={!info}
              >
                <FolderOpen className="size-3.5" strokeWidth={1.8} />
                Abrir pasta
              </Button>
            </div>
          </section>

          <section className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold">Integridade</h3>
                <p className="mt-0.5 text-2xs text-text-secondary">
                  A verificação lê os documentos, mas não altera o vault.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 border-border-tertiary bg-background-primary text-xs"
                  onClick={() => void refresh()}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" strokeWidth={1.8} />
                  )}
                  Verificar
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 border-border-tertiary bg-background-primary text-xs"
                  onClick={() => void rebuild()}
                  disabled={busy || !inspection}
                >
                  <Database className="size-3.5" strokeWidth={1.8} />
                  Reconstruir índice
                </Button>
              </div>
            </div>

            {inspection && inspection.issues.length === 0 ? (
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-[#cfe6d7] bg-[#f1f8f3] p-3 text-[#1c6b45]">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-xs font-semibold">Vault íntegro</p>
                  <p className="mt-0.5 text-2xs leading-relaxed opacity-80">
                    {inspection.indexed}{" "}
                    {inspection.indexed === 1 ? "documento possui" : "documentos possuem"} identidade
                    válida e pode ser indexado.
                  </p>
                </div>
              </div>
            ) : null}

            {inspection && inspection.issues.length > 0 ? (
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-[#ecd9ac] bg-[#fff9e9] p-3 text-[#7a5411]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                <div>
                  <p className="text-xs font-semibold">
                    {inspection.issues.length}{" "}
                    {inspection.issues.length === 1 ? "situação precisa" : "situações precisam"} de
                    atenção
                  </p>
                  <p className="mt-0.5 text-2xs leading-relaxed opacity-80">
                    Arquivos com conflito ficam fora do índice; os originais permanecem no disco.
                  </p>
                </div>
              </div>
            ) : null}
          </section>

          {missingIds.length ? (
            <section className="mt-5">
              <h3 className="text-[13px] font-semibold">Arquivos externos</h3>
              <p className="mt-0.5 text-2xs leading-relaxed text-text-secondary">
                Adotar adiciona a identidade e os metadados do Hyperzettel, preservando o nome do
                arquivo. O conteúdo é sanitizado antes de entrar no vault.
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {missingIds.flatMap((issue) =>
                  issue.fileNames.map((fileName) => (
                    <div
                      key={fileName}
                      className="flex items-center gap-3 rounded-lg border border-border-primary px-3 py-2.5"
                    >
                      <FilePlus2 className="size-4 shrink-0 text-text-secondary" strokeWidth={1.75} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={fileName}>
                          {fileName}
                        </p>
                        <p className="text-2xs text-text-secondary">{issueLabel(issue)}</p>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 shrink-0 border-text-primary bg-text-primary px-3 text-xs text-background-primary"
                        onClick={() => void adopt(fileName)}
                        disabled={Boolean(adopting) || busy}
                      >
                        {adopting === fileName ? (
                          <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                        ) : null}
                        Adotar
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {duplicateIds.length ? (
            <section className="mt-5">
              <h3 className="text-[13px] font-semibold">Identidades duplicadas</h3>
              <p className="mt-0.5 text-2xs leading-relaxed text-text-secondary">
                Abra a pasta e mantenha apenas um arquivo com cada `hz:id`. A resolução assistida
                de duplicatas será adicionada no próximo incremento.
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {duplicateIds.map((issue) => (
                  <div
                    key={`${issue.id}-${issue.fileNames.join("-")}`}
                    className="rounded-lg border border-border-primary px-3 py-2.5"
                  >
                    <p className="text-xs font-medium">ID: {issue.id}</p>
                    <p className="mt-1 break-all text-2xs leading-relaxed text-text-secondary">
                      {issue.fileNames.join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {feedback ? (
            <p className="mt-4 rounded-lg border border-border-primary bg-background-secondary px-3 py-2.5 text-xs text-text-tertiary">
              {feedback}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
