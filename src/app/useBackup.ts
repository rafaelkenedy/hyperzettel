/**
 * Importação e exportação de backup.
 *
 * É o único caso de uso que precisa das notas e do histórico de aprendizagem
 * ao mesmo tempo. Em vez de acoplar os dois providers, ele compõe os dois
 * hooks aqui — que é onde as duas coisas legitimamente se encontram.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { createBackupService } from "@/application/backupService";
import {
  BACKUP_RECORDED_EVENT,
  LAST_BACKUP_STORAGE_KEY,
  evaluateBackupStatus,
  readLastBackupTimestamp,
  recordBackupTimestamp
} from "@/application/backupReminder";
import {
  exportRejectedRelations,
  importRejectedRelations
} from "@/features/knowledge";
import { vaultRepository } from "@/infrastructure/vaultRepository";
import {
  backupFileErrorMessage,
  saveVerifiedBackup
} from "@/infrastructure/backupFileRepository";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNotes } from "@/app/providers/NotesProvider";

export function useBackup() {
  const { announce } = useAnnouncer();
  const { savedNotes, dirty, persistDraft, reload, adoptImported } = useNotes();
  const { exportState, mergeImported } = useKnowledge();
  const [exporting, setExporting] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(() => {
    try {
      return readLastBackupTimestamp(window.localStorage);
    } catch {
      return null;
    }
  });

  const service = useMemo(
    () =>
      createBackupService({
        vault: vaultRepository,
        exportKnowledge: exportState,
        exportRejectedRelations,
        importRejectedRelations
      }),
    [exportState]
  );

  useEffect(() => {
    const sync = () => {
      try {
        setLastExportedAt(readLastBackupTimestamp(window.localStorage));
      } catch {
        setLastExportedAt(null);
      }
      setClock(Date.now());
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === LAST_BACKUP_STORAGE_KEY) sync();
    };
    window.addEventListener(BACKUP_RECORDED_EVENT, sync);
    window.addEventListener("storage", syncStorage);
    const timer = window.setInterval(() => setClock(Date.now()), 60 * 60 * 1000);
    return () => {
      window.removeEventListener(BACKUP_RECORDED_EVENT, sync);
      window.removeEventListener("storage", syncStorage);
      window.clearInterval(timer);
    };
  }, []);

  const backupStatus = useMemo(
    () => evaluateBackupStatus(savedNotes.length, lastExportedAt, clock),
    [clock, lastExportedAt, savedNotes.length]
  );

  const exportNotes = useCallback(async () => {
    setExporting(true);
    try {
      const hadPendingDraft = dirty;
      const persisted = await persistDraft();
      if (hadPendingDraft && !persisted) {
        announce(
          "O rascunho atual não pôde ser salvo. Resolva o conflito antes de criar um backup."
        );
        return;
      }
      const result = await service.exportBackup();
      const receipt = await saveVerifiedBackup(result.fileName, result.contents);
      if (!receipt) {
        announce("Exportação cancelada; o lembrete de backup continua ativo.");
        return;
      }
      if (result.noteCount > 0) {
        const now = Date.now();
        let timestamp: string;
        try {
          timestamp = recordBackupTimestamp(window.localStorage, now);
        } catch {
          timestamp = new Date(now).toISOString();
        }
        setLastExportedAt(timestamp);
        setClock(now);
        window.dispatchEvent(new Event(BACKUP_RECORDED_EVENT));
      }
      announce(
        `Backup verificado em “${receipt.fileName}”: ` +
          `${result.noteCount} ${result.noteCount === 1 ? "nota exportada" : "notas exportadas"}; ` +
          `${result.rejectedRelationCount} ${
            result.rejectedRelationCount === 1
              ? "decisão semântica incluída"
              : "decisões semânticas incluídas"
          }.`
      );
    } catch (error) {
      console.error(error);
      announce(backupFileErrorMessage(error));
    } finally {
      setExporting(false);
    }
  }, [announce, dirty, persistDraft, service]);

  const importNotes = useCallback(
    async (file: File) => {
      try {
        await persistDraft();
        const result = await service.importBackup(file);
        if (!result) return;

        const all = await reload();
        // Backups do Hyperzettelkasten trazem o histórico de aprendizagem junto.
        await mergeImported(result.knowledge, all);
        adoptImported(result.notes);

        announce(
          `${result.notes.length} ${
            result.notes.length === 1 ? "nota importada" : "notas importadas"
          }; ${result.rejectedRelationCount} ${
            result.rejectedRelationCount === 1
              ? "decisão semântica restaurada"
              : "decisões semânticas restauradas"
          }.`
        );
      } catch (error) {
        console.error(error);
        const fallback =
          error instanceof SyntaxError
            ? "O arquivo selecionado não é um JSON válido."
            : (error as Error).message || "Não foi possível importar as notas.";
        announce(fallback);
      }
    },
    [adoptImported, announce, mergeImported, persistDraft, reload, service]
  );

  return { exportNotes, importNotes, backupStatus, exporting };
}
