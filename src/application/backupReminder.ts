const DAY = 24 * 60 * 60 * 1000;

export const BACKUP_INTERVAL_DAYS = 7;
export const BACKUP_RECORDED_EVENT = "hyperzettel:backup-recorded";
export const LAST_BACKUP_STORAGE_KEY = "hyperzettel.backup.lastExportedAt";

export type BackupStatus =
  | { state: "empty"; lastExportedAt: null; ageDays: null }
  | { state: "never"; lastExportedAt: null; ageDays: null }
  | { state: "current" | "due"; lastExportedAt: string; ageDays: number };

function validTimestamp(value: string | null, now: number): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  // Uma data futura corrompida não pode silenciar o lembrete indefinidamente.
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60 * 1000) return null;
  return new Date(timestamp).toISOString();
}

export function evaluateBackupStatus(
  noteCount: number,
  lastExportedAt: string | null,
  now = Date.now()
): BackupStatus {
  if (noteCount <= 0) return { state: "empty", lastExportedAt: null, ageDays: null };
  const valid = validTimestamp(lastExportedAt, now);
  if (!valid) return { state: "never", lastExportedAt: null, ageDays: null };

  const ageDays = Math.max(0, Math.floor((now - Date.parse(valid)) / DAY));
  return {
    state: now - Date.parse(valid) >= BACKUP_INTERVAL_DAYS * DAY ? "due" : "current",
    lastExportedAt: valid,
    ageDays
  };
}

export function readLastBackupTimestamp(
  storage: Pick<Storage, "getItem">,
  now = Date.now()
): string | null {
  try {
    return validTimestamp(storage.getItem(LAST_BACKUP_STORAGE_KEY), now);
  } catch {
    return null;
  }
}

export function recordBackupTimestamp(
  storage: Pick<Storage, "setItem">,
  now = Date.now()
): string {
  const timestamp = new Date(now).toISOString();
  try {
    storage.setItem(LAST_BACKUP_STORAGE_KEY, timestamp);
  } catch {
    // O lembrete continua correto nesta sessão mesmo se o storage estiver indisponível.
  }
  return timestamp;
}
