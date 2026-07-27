/**
 * Importação e exportação de backup.
 *
 * É o único caso de uso que precisa das notas e do histórico de aprendizagem
 * ao mesmo tempo. Em vez de acoplar os dois providers, ele compõe os dois
 * hooks aqui — que é onde as duas coisas legitimamente se encontram.
 */

import { useCallback, useMemo } from "react";

import { createBackupService } from "@/application/backupService";
import {
  exportRejectedRelations,
  importRejectedRelations
} from "@/features/knowledge";
import { vaultRepository } from "@/infrastructure/vaultRepository";
import { useAnnouncer } from "@/app/providers/AnnouncerProvider";
import { useKnowledge } from "@/app/providers/KnowledgeProvider";
import { useNotes } from "@/app/providers/NotesProvider";

export function useBackup() {
  const { announce } = useAnnouncer();
  const { persistDraft, reload, adoptImported } = useNotes();
  const { exportState, mergeImported } = useKnowledge();

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

  const exportNotes = useCallback(async () => {
    try {
      await persistDraft();
      const result = await service.exportBackup();
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      announce(
        `${result.noteCount} ${result.noteCount === 1 ? "nota exportada" : "notas exportadas"}; ` +
          `${result.rejectedRelationCount} ${
            result.rejectedRelationCount === 1
              ? "decisão semântica incluída"
              : "decisões semânticas incluídas"
          }.`
      );
    } catch (error) {
      console.error(error);
      announce("Não foi possível exportar as notas.");
    }
  }, [announce, persistDraft, service]);

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

  return { exportNotes, importNotes };
}
