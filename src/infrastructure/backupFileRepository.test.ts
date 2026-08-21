import { beforeEach, expect, test, vi } from "vitest";

import {
  backupFileErrorMessage,
  saveVerifiedBackup
} from "./backupFileRepository";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

beforeEach(() => invokeMock.mockReset());

test("pede ao backend o diálogo e a gravação verificada sem fornecer caminho", async () => {
  const receipt = {
    path: "C:\\backups\\backup.json",
    fileName: "backup.json",
    bytes: 2,
    sha256: "a".repeat(64)
  };
  invokeMock.mockResolvedValue(receipt);

  await expect(saveVerifiedBackup("backup.json", "{}")).resolves.toEqual(receipt);
  expect(invokeMock).toHaveBeenCalledWith("save_backup_file", {
    suggestedName: "backup.json",
    contents: "{}"
  });
});

test("traduz falha de verificação sem expor diagnóstico interno", () => {
  expect(
    backupFileErrorMessage({
      code: "backup_verification_failed",
      message: "hash mismatch at C:\\private\\backup.json"
    })
  ).toBe(
    "O arquivo foi gravado, mas não passou na verificação. Escolha outro destino."
  );
});
