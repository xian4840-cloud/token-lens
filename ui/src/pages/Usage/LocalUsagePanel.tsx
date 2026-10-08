import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { LocalUsageBarChart } from "@/components/LocalUsageBarChart";
import { formatCost, formatDateKey, formatTokensCn, visibleTokens } from "@/lib/format";
import {
  LOCAL_SOURCE_LABEL as SOURCE_LABEL,
  pivotDailyUsage,
  summarizeLocalRecords,
} from "@/lib/local-sources";
import type { LocalDailyUsageRecord, ScanLocalUsageResult } from "@/types";

/** 当日区间：同日显示 HH:mm~HH:mm */
function formatDayRange(firstAt?: string | null, lastAt?: string | null): string {
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const f = firstAt ?? undefined;
  const l = lastAt ?? undefined;
  if (f && l) return `${hhmm(f)}~${hhmm(l)}`;
  if (f) return hhmm(f);
  if (l) return hhmm(l);
  return "-";
}

/** 本地 agent tab 的内容；展开状态留在页面里，切 tab 回来不丢 */
export function LocalUsagePanel({
  localUsageUnavailable,
  localReady,
  localRows,
  localUsageScanning,
  dailyChartData,
  groupedByDate,
  expandedDates,
  setExpandedDates,
  toggleDate,
}: {
  localUsageUnavailable: ScanLocalUsageResult["unavailable"];
  localReady: boolean;
  localRows: LocalDailyUsageRecord[];
  localUsageScanning: boolean;
  dailyChartData: ReturnType<typeof pivotDailyUsage>;
  groupedByDate: Map<string, LocalDailyUsageRecord[]>;
  expandedDates: Set<string>;
  setExpandedDates: (next: Set<string>) => void;
  toggleDate: (date: string) => void;
}) {
  return (
    <div className="space-y-4">
      {localUsageUnavailable.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="mb-2 text-sm font-medium text-muted-foreground">以下来源不可用</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {localUsageUnavailable.map((u) => (
                <li key={u.source}>
                  <span className="font-medium text-foreground">{SOURCE_LABEL[u.source]}</span>：
                  {u.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!localReady ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            加载中…
          </CardContent>
        </Card>
      ) : localRows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
            <Bot className="size-6" />
            <p>
              {localUsageScanning ? "扫描中…" : "暂无本地 agent 用量数据。点击右上角「重新扫描」。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 每日堆叠柱状图（按来源） */}
          <Card>
            <CardContent className="py-4">
              <div className="mb-3 text-sm font-medium text-muted-foreground">
                每日用量（按来源堆叠；输入已拆出缓存，总量含缓存一次）
              </div>
              <LocalUsageBarChart data={dailyChartData} height={240} />
            </CardContent>
          </Card>

          {/* 按天明细表 */}
          <Card>
            <CardContent className="p-0">
              {groupedByDate.size > 1 ? (
                <div className="flex items-center justify-end px-4 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const dates = [...groupedByDate.keys()];
                      const allOn = dates.length > 0 && dates.every((d) => expandedDates.has(d));
                      setExpandedDates(allOn ? new Set() : new Set(dates));
                    }}
                  >
                    {[...groupedByDate.keys()].every((d) => expandedDates.has(d))
                      ? "全部收起"
                      : "全部展开"}
                  </Button>
                </div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 text-right font-medium">总 Tokens</th>
                      <th className="px-4 py-3 text-right font-medium">总费用</th>
                      <th className="px-4 py-3 text-right font-medium">明细</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...groupedByDate.entries()].map(([date, rows]) => {
                      const isExpanded = expandedDates.has(date);
                      const day = summarizeLocalRecords(rows, date);

                      return (
                        <>
                          {/* 日期汇总行 */}
                          <tr
                            key={date}
                            className="border-b border-border/60 cursor-pointer transition-colors hover:bg-accent/30"
                            onClick={() => toggleDate(date)}
                          >
                            <td className="px-4 py-3 font-medium">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="size-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="size-4 text-muted-foreground" />
                                )}
                                {formatDateKey(date)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-medium">
                              {formatTokensCn(day.tokens)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-medium">
                              {formatCost(day.cost, day.currency)}
                              {day.hasUnpriced ? (
                                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                                  含未标价
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">
                              {rows.length} 条记录
                            </td>
                          </tr>

                          {/* 展开的明细行 */}
                          {isExpanded &&
                            rows.map((r) => {
                              const total = visibleTokens(r);
                              return (
                                <tr
                                  key={`${r.source}-${r.model}-${r.date}`}
                                  className="border-b border-border/40 bg-accent/10 transition-colors last:border-0 hover:bg-accent/20"
                                >
                                  <td className="pl-12 pr-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs">
                                        {SOURCE_LABEL[r.source]}
                                      </Badge>
                                      <span className="font-mono text-xs text-muted-foreground">
                                        {r.model}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                                    <div className="space-y-0.5">
                                      <div>{formatTokensCn(total)}</div>
                                      <div className="text-[10px] text-muted-foreground">
                                        输入 {formatTokensCn(r.inputTokens)} / 输出{" "}
                                        {formatTokensCn(r.outputTokens + r.reasoningTokens)}
                                        {r.cacheReadTokens > 0 &&
                                          ` / 缓存读 ${formatTokensCn(r.cacheReadTokens)}`}
                                        {r.cacheCreationTokens > 0 &&
                                          ` / 缓存写 ${formatTokensCn(r.cacheCreationTokens)}`}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                                    {formatCost(r.cost, r.currency)}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                                    {r.sessions} 会话 · {formatDayRange(r.firstAt, r.lastAt)}
                                  </td>
                                </tr>
                              );
                            })}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
