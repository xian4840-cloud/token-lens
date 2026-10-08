import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";

/** 本地用量缓存清理 */
export function LocalCacheSection() {
  const [clearingCache, setClearingCache] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearCacheMessage, setClearCacheMessage] = useState<string | null>(null);

  const handleClearCache = async () => {
    setClearingCache(true);
    setClearCacheMessage(null);
    try {
      const result = await ipc.clearLocalUsageCache();
      if (result.success) {
        setClearCacheMessage("缓存已清除，并重新扫描了用量数据。");
        showToast("缓存已清除并重新扫描");
      } else {
        setClearCacheMessage(`清除失败：${result.error || "未知错误"}`);
        showToast(result.error || "清除失败", "err");
      }
      setClearCacheOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setClearCacheMessage(`清除失败：${msg}`);
      showToast(msg, "err");
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-medium">本地用量缓存</CardTitle>
          <CardDescription>
            清除缓存后会重新扫描所有 agent 会话记录。如果发现统计数据异常，可以尝试清除缓存。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setClearCacheMessage(null);
              setClearCacheOpen(true);
            }}
            disabled={clearingCache}
            className="gap-1.5"
          >
            {clearingCache ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                清除中...
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" />
                清除缓存并重新扫描
              </>
            )}
          </Button>
          {clearCacheMessage ? (
            <p className="mt-3 text-xs text-muted-foreground">{clearCacheMessage}</p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              注意：此操作会清空所有历史统计记录，重新扫描可能需要几秒到几分钟（取决于会话文件数量）。
            </p>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={clearCacheOpen}
        onOpenChange={setClearCacheOpen}
        title="清除本地用量缓存？"
        description="将删除所有缓存数据和历史统计记录，然后重新扫描。此操作不可撤销。"
        confirmLabel="清除并重扫"
        destructive
        busy={clearingCache}
        onConfirm={handleClearCache}
      />
    </>
  );
}
