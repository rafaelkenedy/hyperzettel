import { describe, expect, test, vi } from "vitest";

import {
  BACKUP_INTERVAL_DAYS,
  LAST_BACKUP_STORAGE_KEY,
  evaluateBackupStatus,
  readLastBackupTimestamp,
  recordBackupTimestamp
} from "./backupReminder";

const NOW = Date.parse("2026-07-26T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("política do lembrete de backup", () => {
  test("não recomenda backup para um vault vazio", () => {
    expect(evaluateBackupStatus(0, null, NOW)).toEqual({
      state: "empty",
      lastExportedAt: null,
      ageDays: null
    });
  });

  test("recomenda o primeiro backup assim que existem notas", () => {
    expect(evaluateBackupStatus(1, null, NOW).state).toBe("never");
  });

  test("considera o backup atual durante sete dias", () => {
    const sixDaysAgo = new Date(NOW - 6 * DAY).toISOString();
    expect(evaluateBackupStatus(3, sixDaysAgo, NOW)).toMatchObject({
      state: "current",
      ageDays: 6
    });
  });

  test("recomenda novo backup no sétimo dia", () => {
    const dueAt = new Date(NOW - BACKUP_INTERVAL_DAYS * DAY).toISOString();
    expect(evaluateBackupStatus(3, dueAt, NOW)).toMatchObject({
      state: "due",
      ageDays: 7
    });
  });

  test("data futura ou inválida não silencia o lembrete", () => {
    expect(evaluateBackupStatus(2, "inválida", NOW).state).toBe("never");
    expect(
      evaluateBackupStatus(2, new Date(NOW + DAY).toISOString(), NOW).state
    ).toBe("never");
  });
});

describe("persistência do lembrete", () => {
  test("não promove o antigo download iniciado a backup verificado", () => {
    const oldTimestamp = "2026-07-25T12:00:00.000Z";
    const storage = {
      getItem: (key: string) =>
        key === "hyperzettel.backup.lastExportedAt" ? oldTimestamp : null
    };

    expect(LAST_BACKUP_STORAGE_KEY).toBe("hyperzettel.backup.lastVerifiedAt");
    expect(readLastBackupTimestamp(storage, NOW)).toBeNull();
  });

  test("grava e lê a data da última exportação", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(recordBackupTimestamp(storage, NOW)).toBe("2026-07-26T12:00:00.000Z");
    expect(values.get(LAST_BACKUP_STORAGE_KEY)).toBe("2026-07-26T12:00:00.000Z");
    expect(readLastBackupTimestamp(storage, NOW)).toBe("2026-07-26T12:00:00.000Z");
  });

  test("falha do storage não impede a sessão", () => {
    const setItem = vi.fn(() => {
      throw new Error("storage indisponível");
    });
    const getItem = vi.fn(() => {
      throw new Error("storage indisponível");
    });

    expect(recordBackupTimestamp({ setItem }, NOW)).toBe("2026-07-26T12:00:00.000Z");
    expect(readLastBackupTimestamp({ getItem }, NOW)).toBeNull();
  });
});
