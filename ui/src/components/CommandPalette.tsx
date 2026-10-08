import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/app";
import { showToast } from "@/lib/toast";
import { ipc } from "@/lib/ipc";
import { formatDiagnosticSummary } from "@/lib/diagnostics";
import { copyText } from "@/lib/copy-text";
import { clampIndex, stepIndex } from "@/lib/command-nav";
import {
  formatBackupImportResult,
  formatBackupPreviewText,
  prepareBackupImport,
  type BackupPreview,
} from "@/lib/backup-import";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [backupPending, setBackupPending] = useState<{
    raw: string;
    preview: BackupPreview;
  } | null>(null);
  const items = useMemo(
    () => [
      { label: "去总览", run: () => navigate("/") },
      { label: "去用量明细", run: () => navigate("/usage") },
      { label: "去趋势", run: () => navigate("/trends") },
      { label: "去模型监测", run: () => navigate("/model-monitor") },
      { label: "去管理", run: () => navigate("/services") },
      { label: "去设置", run: () => navigate("/settings") },
      { label: "去价格表", run: () => navigate("/settings/pricing") },
      {
        label: "全部刷新",
        run: () => {
          void useAppStore.getState().refreshAll();
          showToast("已开始刷新");
        },
      },
      {
        label: "重试失败服务",
        run: () => {
          const { services, errors, refreshService } = useAppStore.getState();
          const failed = services.filter((s) => errors[s.id]);
          if (failed.length === 0) {
            showToast("没有失败的服务");
            return;
          }
          for (const s of failed) void refreshService(s.id);
          showToast(`已重试 ${failed.length} 个`);
        },
      },
      {
        label: "重新扫描本地用量",
        run: () => {
          navigate("/usage");
          showToast("已开始扫描本地用量");
          void useAppStore
            .getState()
            .scanLocalUsage()
            .then(undefined, (e: unknown) =>
              showToast(e instanceof Error ? e.message : "扫描失败", "err"),
            );
        },
      },
      {
        label: "导入备份",
        run: () => {
          void (async () => {
            const r = await prepareBackupImport();
            if (!r.ok) {
              if ("error" in r) showToast(r.error, "err");
              return;
            }
            setBackupPending({ raw: r.raw, preview: r.preview });
          })();
        },
      },
      {
        label: "复制诊断摘要",
        run: () => {
          void (async () => {
            try {
              const [logs, logPath, stats] = await Promise.all([
                ipc.getRecentLogs(),
                ipc.getLogPath(),
                ipc.dataStats(),
              ]);
              const text = formatDiagnosticSummary({
                stats,
                logPath,
                logs: [...logs].reverse(),
                limit: 30,
              });
              if (!text) {
                showToast("暂无诊断内容", "err");
                return;
              }
              copyText(text, "已复制诊断摘要（未上传）");
            } catch (e) {
              showToast(e instanceof Error ? e.message : "复制失败", "err");
            }
          })();
        },
      },
      {
        label: "导出备份",
        run: () => {
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
            }
          })();
        },
      },
    ],
    [navigate],
  );
  const visible = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const highlight = clampIndex(active, visible.length);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const runAt = (index: number) => {
    const item = visible[index];
    if (!item) return;
    item.run();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setQ("");
            setActive(0);
          }
          onOpenChange(v);
        }}
      >
        <DialogContent className="max-w-md p-4">
          <DialogHeader>
            <DialogTitle>命令</DialogTitle>
            <DialogDescription>Ctrl+K 打开。↑↓ 选择，Enter 执行。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="跳转、刷新、导出…"
            aria-label="过滤命令"
            role="combobox"
            aria-expanded={open}
            aria-controls="command-list"
            aria-activedescendant={visible.length > 0 ? `cmd-item-${highlight}` : undefined}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(stepIndex(highlight, 1, visible.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(stepIndex(highlight, -1, visible.length));
              } else if (e.key === "Home") {
                e.preventDefault();
                setActive(0);
              } else if (e.key === "End") {
                e.preventDefault();
                setActive(Math.max(0, visible.length - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(highlight);
              }
            }}
          />
          <ul id="command-list" role="listbox" className="mt-2 max-h-64 overflow-auto text-sm">
            {visible.length === 0 ? (
              <li className="px-2 py-3 text-muted-foreground">没有匹配的命令</li>
            ) : (
              visible.map((i, idx) => (
                <li key={i.label} role="presentation">
                  <button
                    type="button"
                    id={`cmd-item-${idx}`}
                    role="option"
                    aria-selected={idx === highlight}
                    className={
                      idx === highlight
                        ? "w-full rounded-md bg-accent/60 px-2 py-1.5 text-left"
                        : "w-full rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
                    }
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => runAt(idx)}
                  >
                    {i.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={backupPending != null}
        onOpenChange={(v) => {
          if (!v) setBackupPending(null);
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
