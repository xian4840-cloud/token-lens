import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { formatCost, formatTime } from "@/lib/format";
import type { ServiceRecord, UsageRecord } from "@/types";

function formatTokens(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString();
}

/** API 用量 tab 的内容；数据与派生值都由页面传入，本身不持有状态 */
export function ApiUsagePanel({
  unsupportedServices,
  supportedServices,
  refreshErrors,
  usageReady,
  records,
  nameOf,
}: {
  unsupportedServices: ServiceRecord[];
  supportedServices: ServiceRecord[];
  refreshErrors: { name: string; msg: string | undefined }[];
  usageReady: boolean;
  records: UsageRecord[];
  nameOf: (id: string) => string;
}) {
  return (
    <div className="space-y-4">
      {unsupportedServices.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 text-sm font-medium text-muted-foreground">
              以下服务不支持用量查询（无公开 usage API，仅查看余额）
            </div>
            <div className="flex flex-wrap gap-2">
              {unsupportedServices.map((s) => (
                <Badge key={s.id} variant="secondary">
                  {s.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {refreshErrors.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 text-sm font-medium text-destructive">部分服务刷新失败</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {refreshErrors.map((e) => (
                <li key={e.name}>
                  <span className="font-medium text-foreground">{e.name}</span>：
                  <button
                    type="button"
                    className="hover:underline"
                    title="复制"
                    aria-label={`复制「${e.name}」错误`}
                    onClick={() => copyText(`${e.name}：${e.msg}`)}
                  >
                    {e.msg}
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!usageReady ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            加载中…
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
            <Coins className="size-6" />
            <p>
              暂无用量数据。
              {supportedServices.length > 0
                ? "点击右上角「刷新用量」拉取。"
                : "当前没有支持用量查询的服务。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">服务</th>
                    <th className="px-4 py-3 font-medium">模型</th>
                    <th className="px-4 py-3 text-right font-medium">Tokens</th>
                    <th className="px-4 py-3 text-right font-medium">费用</th>
                    <th className="px-4 py-3 text-right font-medium">记录时间</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-white/30"
                    >
                      <td className="px-4 py-3">{nameOf(r.serviceId)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.model ?? "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatTokens(
                          r.totalTokens ??
                            (r.promptTokens != null || r.completionTokens != null
                              ? (r.promptTokens ?? 0) + (r.completionTokens ?? 0)
                              : null),
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCost(r.cost, r.currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatTime(r.recordedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
