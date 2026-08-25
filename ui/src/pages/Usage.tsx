import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Coins } from "lucide-react";
import { useAppStore } from "@/store/app";
import { LocalUsageTooltip } from "@/components/LocalUsageTooltip";
import { formatTokensCn } from "@/lib/format";
import {
  LOCAL_SOURCES as CHART_SOURCES,
  LOCAL_SOURCE_COLORS as CHART_COLORS,
  LOCAL_SOURCE_LABEL as SOURCE_LABEL,
  type DailyUsageRow,
} from "@/lib/local-sources";
import type { LocalDailyUsageRecord } from "@/types";

type Range = "month" | "7d" | "30d" | "all";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "month", label: "当月" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

/** 每日堆叠柱状图的来源系列（固定顺序与配色，见 lib/local-sources.ts） */

/** 时间范围 -> 刷新用的时间区间（全部不可刷新） */
function rangeToPeriod(range: Range): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;
  if (range === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    const days = range === "7d" ? 7 : 30;
    start = new Date(now);
    start.setDate(start.getDate() - days);
  }
  return { start: start.toISOString(), end };
}

/** 时间范围 -> 查询历史记录的起始（全部不过滤） */
function rangeToSince(range: Range): string | undefined {
  if (range === "all") return undefined;
  return rangeToPeriod(range).start;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return "-";
  return n.toLocaleString();
}

/** 紧凑数字（图表 Y 轴用）：1.23M / 12.3K / 123 */
function formatCompact(n: number | null | undefined): string {
  if (n == null) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatCost(
  n: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (n == null) return "-";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${symbol}${n.toFixed(4)}`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 日期键 YYYY-MM-DD -> MM-DD 展示 */
function formatDateKey(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}

/** 当日区间：同日显示 HH:mm~HH:mm */
function formatDayRange(
  firstAt?: string | null,
  lastAt?: string | null,
): string {
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

/** 透视每日用量为 Recharts 宽表：[{ date, [source]: tokens, input, output, total, models }]，按 source 堆叠 */
function pivotDaily(records: LocalDailyUsageRecord[]): DailyUsageRow[] {
  const byDate = new Map<string, DailyUsageRow>();
  for (const r of records) {
    const total =
      r.inputTokens +
      r.outputTokens +
      r.cacheCreationTokens +
      r.cacheReadTokens +
      r.reasoningTokens;
    const row =
      byDate.get(r.date) ?? { date: formatDateKey(r.date) };
    const cur = (row[r.source] as number | undefined) ?? 0;
    row[r.source] = cur + total;
    row.input = (row.input ?? 0) + r.inputTokens;
    row.output =
      (row.output ?? 0) + r.outputTokens + r.reasoningTokens;
    row.total = (row.total ?? 0) + total;
    const models = row.models ?? {};
    const list = models[r.source] ?? [];
    const found = list.find((m) => m.model === r.model);
    if (found) found.tokens += total;
    else list.push({ model: r.model, tokens: total });
    models[r.source] = list;
    row.models = models;
    byDate.set(r.date, row);
  }
  // 模型分项按用量降序，最常用的排前面
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => ({
      ...v,
      models: Object.fromEntries(
        Object.entries(v.models ?? {}).map(([source, list]) => [
          source,
          [...list].sort((a, b) => b.tokens - a.tokens),
        ]),
      ),
    }));
}

export function Usage() {
  const services = useAppStore((s) => s.services);
  const definitions = useAppStore((s) => s.definitions);
  const usageRecords = useAppStore((s) => s.usageRecords);
  const usageRefreshing = useAppStore((s) => s.usageRefreshing);
  const errors = useAppStore((s) => s.errors);
  const loaded = useAppStore((s) => s.loaded);
  const init = useAppStore((s) => s.init);
  const loadUsage = useAppStore((s) => s.loadUsage);
  const refreshAllUsage = useAppStore((s) => s.refreshAllUsage);

  const localUsageUnavailable = useAppStore((s) => s.localUsageUnavailable);
  const localUsageScanning = useAppStore((s) => s.localUsageScanning);
  const scanLocalUsage = useAppStore((s) => s.scanLocalUsage);
  const localDailyRecords = useAppStore((s) => s.localDailyRecords);
  const loadLocalDaily = useAppStore((s) => s.loadLocalDaily);

  const [range, setRange] = useState<Range>("month");
  const [tab, setTab] = useState<"api" | "local">("api");

  useEffect(() => {
    if (!loaded) init();
  }, [loaded, init]);

  useEffect(() => {
    loadUsage(rangeToSince(range));
  }, [range, loadUsage]);

  // 切到本地 agent tab 或切换时间范围时加载持久化的每日历史
  useEffect(() => {
    if (tab === "local") {
      loadLocalDaily(rangeToSince(range));
    }
  }, [tab, range, loadLocalDaily]);

  const nameOf = (id: string) =>
    services.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const supportedProviders = useMemo(
    () =>
      new Set(
        definitions.filter((d) => d.supportsUsage).map((d) => d.provider),
      ),
    [definitions],
  );

  const unsupportedServices = services.filter(
    (s) => !supportedProviders.has(s.provider),
  );
  const supportedServices = services.filter((s) =>
    supportedProviders.has(s.provider),
  );

  const refreshErrors = supportedServices
    .map((s) => ({ name: s.name, msg: errors[s.id] }))
    .filter((e) => e.msg);

  const handleRefresh = async () => {
    if (range === "all") return;
    await refreshAllUsage(rangeToPeriod(range));
    await loadUsage(rangeToSince(range));
  };

  const records = useMemo(
    () =>
      [...usageRecords].sort((a, b) =>
        b.recordedAt.localeCompare(a.recordedAt),
      ),
    [usageRecords],
  );

  // 本地每日明细：按日期倒序，同日按来源+模型
  const localRows = useMemo(
    () =>
      [...localDailyRecords].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.source.localeCompare(b.source) ||
          a.model.localeCompare(b.model),
      ),
    [localDailyRecords],
  );

  // 部分上游（GLM/Kimi 代理、Codex）不上报缓存写：结果集全 0 时隐藏写列，避免「全是 0」的坏观感
  const showCacheWrite = useMemo(
    () => localRows.some((r) => r.cacheCreationTokens > 0),
    [localRows],
  );

  const dailyChartData = useMemo(() => pivotDaily(localDailyRecords), [localDailyRecords]);

  return (
    <div>
      <PageHeader
        title="用量明细"
        description="跨服务按模型汇总的用量与支出；本地 agent 按天扫描本机使用记录换算"
      />

      <div className="px-8">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "api" | "local")}
        >
          <div className="flex items-center justify-between py-4">
            <TabsList>
              <TabsTrigger value="api">API 用量</TabsTrigger>
              <TabsTrigger value="local">本地 agent</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Select value={range} onValueChange={(v) => setRange(v as Range)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tab === "api" ? (
                <Button
                  onClick={handleRefresh}
                  disabled={
                    range === "all" ||
                    usageRefreshing ||
                    supportedServices.length === 0
                  }
                >
                  {usageRefreshing ? "刷新中…" : "刷新用量"}
                </Button>
              ) : (
                <Button
                  onClick={() => scanLocalUsage(rangeToSince(range))}
                  disabled={localUsageScanning}
                >
                  {localUsageScanning ? "扫描中…" : "重新扫描"}
                </Button>
              )}
            </div>
          </div>

          {/* ---- API 用量 ---- */}
          <TabsContent value="api">

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
                    <div className="mb-2 text-sm font-medium text-destructive">
                      部分服务刷新失败
                    </div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {refreshErrors.map((e) => (
                        <li key={e.name}>
                          <span className="font-medium text-foreground">
                            {e.name}
                          </span>
                          ：{e.msg}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {records.length === 0 ? (
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
                            <th className="px-4 py-3 text-right font-medium">
                              Tokens
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              费用
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              记录时间
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((r) => (
                            <tr key={r.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-white/30">
                              <td className="px-4 py-3">{nameOf(r.serviceId)}</td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {r.model ?? "-"}
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">
                                {formatTokens(
                                  r.totalTokens ??
                                    (r.promptTokens != null ||
                                    r.completionTokens != null
                                      ? (r.promptTokens ?? 0) +
                                        (r.completionTokens ?? 0)
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
          </TabsContent>

          {/* ---- 本地 agent ---- */}
          <TabsContent value="local">
            <div className="space-y-4">
              {localUsageUnavailable.length > 0 && (
                <Card>
                  <CardContent className="py-4">
                    <div className="mb-2 text-sm font-medium text-muted-foreground">
                      以下来源不可用
                    </div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {localUsageUnavailable.map((u) => (
                        <li key={u.source}>
                          <span className="font-medium text-foreground">
                            {SOURCE_LABEL[u.source]}
                          </span>
                          ：{u.reason}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {localRows.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
                    <Bot className="size-6" />
                    <p>
                      {localUsageScanning
                        ? "扫描中…"
                        : "暂无本地 agent 用量数据。点击右上角「重新扫描」。"}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* 每日堆叠柱状图（按来源） */}
                  <Card>
                    <CardContent className="py-4">
                      <div className="mb-3 text-sm font-medium text-muted-foreground">
                        每日用量（按来源堆叠，tokens）
                      </div>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={dailyChartData}>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="rgba(110, 95, 70, 0.12)"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                            dy={6}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                            width={48}
                            tickFormatter={formatCompact}
                          />
                          <Tooltip
                            cursor={{ fill: "rgba(110, 95, 70, 0.06)" }}
                            content={<LocalUsageTooltip />}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          {CHART_SOURCES.map((s, i) => (
                            <Bar
                              key={s.value}
                              dataKey={s.value}
                              name={s.label}
                              stackId="a"
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
                              radius={[3, 3, 0, 0]}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* 按天明细表 */}
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs tracking-wide text-muted-foreground">
                              <th className="px-4 py-3 font-medium">来源</th>
                              <th className="px-4 py-3 font-medium">模型</th>
                              <th className="px-4 py-3 font-medium">日期</th>
                              <th className="px-4 py-3 text-right font-medium">
                                会话
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Input
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Output
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                {showCacheWrite ? "缓存读/写" : "缓存读"}
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Tokens
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                费用
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                区间
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {localRows.map((r) => {
                              const total =
                                r.inputTokens +
                                r.outputTokens +
                                r.cacheCreationTokens +
                                r.cacheReadTokens +
                                r.reasoningTokens;
                              return (
                                <tr
                                  key={`${r.source}-${r.model}-${r.date}`}
                                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-white/30"
                                >
                                  <td className="px-4 py-3">
                                    <Badge variant="secondary">
                                      {SOURCE_LABEL[r.source]}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs">
                                    {r.model}
                                  </td>
                                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                                    {formatDateKey(r.date)}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {r.sessions}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {formatTokensCn(r.inputTokens)}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {formatTokensCn(
                                      r.outputTokens + r.reasoningTokens,
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                                    {showCacheWrite
                                      ? `${formatTokensCn(r.cacheReadTokens)} / ${formatTokensCn(r.cacheCreationTokens)}`
                                      : formatTokensCn(r.cacheReadTokens)}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {formatTokensCn(total)}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {formatCost(r.cost, r.currency)}
                                  </td>
                                  <td className="px-4 py-3 text-right text-muted-foreground">
                                    {formatDayRange(r.firstAt, r.lastAt)}
                                  </td>
                                </tr>
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
