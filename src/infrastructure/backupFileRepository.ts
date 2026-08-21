import { invoke } from "@tauri-apps/api/core";

export interface BackupReceipt {
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
}

/**
 * O backend abre o diálogo — o frontend nunca fornece um caminho arbitrário —
 * e só devolve recibo depois de gravar, sincronizar e reler o arquivo.
 */
export function saveVerifiedBackup(
  suggestedName: string,
  contents: string
): Promise<BackupReceipt | null> {
  return invoke<BackupReceipt | null>("save_backup_file", {
    suggestedName,
    contents
  });
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function backupFileErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "backup_verification_failed":
      return "O arquivo foi gravado, mas não passou na verificação. Escolha outro destino.";
    case "backup_too_large":
      return "O backup excede o limite de 120 MB.";
    case "backup_path_invalid":
      return "O destino escolhido não pode receber este backup.";
    case "backup_io_error":
      return "Não foi possível gravar ou verificar o arquivo no destino escolhido.";
    default:
      return "Não foi possível exportar as notas.";
  }
}
