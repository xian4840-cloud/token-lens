import { ipc } from "./ipc";
import { pickTextFile, readFileAsText } from "./pick-file";
import type { BackupPreview } from "./backup-preview";

export type { BackupPreview } from "./backup-preview";
export { formatBackupPreviewText } from "./backup-preview";

export type PrepareBackupResult =
  | { ok: true; raw: string; preview: BackupPreview }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

export async function prepareBackupImport(): Promise<PrepareBackupResult> {
  const file = await pickTextFile("application/json");
  if (!file) return { ok: false, cancelled: true };
  const read = await readFileAsText(file);
  if (!read.ok) return { ok: false, error: read.error };
  try {
    const preview = await ipc.previewBackup(read.text);
    return { ok: true, raw: read.text, preview };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "预览失败",
    };
  }
}