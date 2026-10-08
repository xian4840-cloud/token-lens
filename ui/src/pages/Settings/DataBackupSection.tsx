import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import {
  formatBackupImportResult,
  formatBackupPreviewText,
  prepareBackupImport,
  type BackupPreview,
} from "@/lib/backup-import";

/** 数据目录、备份导出与导入 */
export function DataBackupSection() {
  const [backingUp, setBackingUp] = useState(false);
  const [backupPending, setBackupPending] = useState<{
    raw: string;
    preview: BackupPreview;
  } | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-medium">数据与日志</CardTitle>
          <CardDescription>
            配置、密钥密文和用量历史都在本机 userData 目录，不会上传。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void ipc.revealUserData()}>
            打开数据目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={backingUp}
            onClick={() => {
              setBackingUp(true);
              void (async () => {
                try {
                  const json = await ipc.backupJson();
                  const ok = await ipc.saveText(
                    `token-lens-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    json,
                  );
                  if (ok) showToast("备份已导出（不含密钥）");
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "导出失败", "err");
                } finally {
                  setBackingUp(false);
                }
              })();
            }}
          >
            {backingUp ? "导出中…" : "导出备份"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                const r = await prepareBackupImport();
                if (!r.ok) {
                  if ("error" in r) showToast(r.error, "err");
                  return;
                }
                setBackupPending({ raw: r.raw, preview: r.preview });
              })();
            }}
          >
            导入备份
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            备份含服务清单、用量历史和价格覆盖，不含 API Key、Cookie 和代理地址。导入不会写入密钥。
          </p>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={backupPending != null}
        onOpenChange={(open) => {
          if (!open) setBackupPending(null);
        }}
        title="导入备份？"
        description={backupPending ? formatBackupPreviewText(backupPending.preview) : "导入备份"}
        confirmLabel="导入"
        onConfirm={() => {
          const pending = backupPending;
          setBackupPending(null);
          if (!pending) return;
          void ipc.importBackup(pending.raw).then(
            (r) => {
              showToast(formatBackupImportResult(r));
              void useAppStore.getState().reloadAfterBackupImport();
            },
            (e: unknown) => showToast(e instanceof Error ? e.message : "导入失败", "err"),
          );
        }}
      />
    </>
  );
}
