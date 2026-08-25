import { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, RotateCw, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { LogEntry, LogLevel } from "@/types";

/**
 * 诊断日志卡片。
 *
 * 存在的意义：用户报「一直转圈」「点了没反应」时，此前完全没有可核对的信息。
 * 现在错误会落到本地日志，用户能在这里直接看到最近发生了什么，
 * 也能一键定位到日志文件、附到反馈里发过来。
 *
 * 刻意不做的事：不提供任何「上传日志」按钮。日志留在本机，
 * 发不发、发给谁由用户自己决定（见 README 隐私说明）。
 */

/** 只展示最近这么多条：出问题时最新的几条才有价值，翻太多反而找不到重点 */
const VISIBLE_LIMIT = 30;

const LEVEL_STYLE: Record<LogLevel, string> = {
  error: "text-destructive",
  warn: "text-amber-600",
  info: "text-muted-foreground",
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "错误",
  warn: "警告",
  info: "信息",
};

export function DiagnosticsCard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logPath, setLogPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entries, p] = await Promise.all([
        window.tokenLens.getRecentLogs(),
        window.tokenLens.getLogPath(),
      ]);
      // 新的在前，便于第一眼看到最近的错误
      setLogs([...entries].reverse());
      setLogPath(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClear = async () => {
    await window.tokenLens.clearLogs();
    await load();
  };

  const errorCount = logs.filter((l) => l.level === "error").length;
  const shown = expanded ? logs : logs.slice(0, VISIBLE_LIMIT);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="font-display text-lg font-medium flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              诊断日志
            </CardTitle>
            <CardDescription>
              运行期间的错误记录，仅保存在本机。遇到问题时可点「打开日志文件」，
              把文件附在反馈里。日志写入前已自动隐去 API Key。
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RotateCw className={loading ? "size-4 animate-spin" : "size-4"} />
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.tokenLens.revealLogFile()}
            >
              <FolderOpen className="size-4" />
              打开日志文件
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleClear()}>
              <Trash2 className="size-4" />
              清空
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          共 {logs.length} 条
          {errorCount > 0 ? `，其中 ${errorCount} 条错误` : "，暂无错误"}
          {logPath ? ` · 文件位置：${logPath}` : ""}
        </div>

        {logs.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            暂无日志记录。应用运行中出现错误时会记在这里。
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-md border bg-muted/30">
            {shown.map((entry, i) => (
              <div
                key={`${entry.time}-${i}`}
                className="flex gap-3 border-b px-3 py-2 text-xs last:border-b-0"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTime(entry.time)}
                </span>
                <span className={`shrink-0 font-medium ${LEVEL_STYLE[entry.level]}`}>
                  {LEVEL_LABEL[entry.level]}
                </span>
                <span className="shrink-0 text-muted-foreground">[{entry.scope}]</span>
                {/* break-all：错误消息里常有长 URL，不换行会把布局撑破 */}
                <span className="break-all">{entry.message}</span>
              </div>
            ))}
          </div>
        )}

        {logs.length > VISIBLE_LIMIT && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "只看最近 30 条" : `展开全部 ${logs.length} 条`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
