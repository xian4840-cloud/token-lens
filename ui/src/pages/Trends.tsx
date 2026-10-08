import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/store/app";
import { CHART_TOOLTIP_STYLE } from "@/components/LocalUsageTooltip";
import { LocalUsageBarChart } from "@/components/LocalUsageBarChart";
import { formatCompact, formatRelative } from "@/lib/format";
import { pivotDailyUsage } from "@/lib/local-sources";
import type { BalanceSnapshot } from "@/types";

type Range = "7d" | "30d" | "all";
type Metric = "tokens" | "cost";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

/** 时间范围 -> 起始 ISO 字符串（全部返回 undefined 不过滤） */
function rangeToSince(range: Range): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const CURRENCY_LABEL: Record<string, string> = {
  USD: "美元 ($)",
  CNY: "人民币 (¥)",
  "%": "百分比 (%)",
  tokens: "Tokens",
};

/* 图表配色：前五色取自主题（插画提取），后五色为协调补色 */
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#8b6f8e",
  "#6f8f7a",
  "#c99595",
  "#7a8ba0",
  "#b3a25f",
];

/** X 轴时间标签：按天显示 MM-DD，细粒度显示 MM-DD HH:mm */
function formatAxisTime(iso: string, byDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (byDay) return `${mm}-${dd}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * 透视成 Recharts 宽表：[{ date, [服务名]: 余额, ... }]
 * byDay=true 按天聚合（取每天最后值）；false 按每次快照一个点。
 * 前向填充：某时间点某服务无新快照时沿用前值，使折线连续。
 */
function pivot(
  snapshots: BalanceSnapshot[],
  nameOf: (id: string) => string,
  byDay: boolean,
): { date: string; [key: string]: number | string }[] {
  const byService = new Map<string, BalanceSnapshot[]>();
  for (const s of snapshots) {
    if (s.balance == null) continue;
    if (!byService.has(s.serviceId)) byService.set(s.serviceId, []);
    byService.get(s.serviceId)!.push(s);
  }
  for (const snaps of byService.values()) {
    snaps.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }

  // 收集所有时间桶（各服务快照点的并集）
  const buckets = new Set<string>();
  for (const snaps of byService.values()) {
    for (const s of snaps) {
      buckets.add(byDay ? s.recordedAt.slice(0, 10) : s.recordedAt);
    }
  }
  const keys = [...buckets].sort();

  // 双指针前向填充：桶与各服务快照均按时间有序，指针单调推进，
  // 避免每桶重新线性扫（数据量大时从 O(桶×快照) 降为 O(桶+快照)）
  const ptrs = new Map<string, number>();
  const latest = new Map<string, BalanceSnapshot>();
  return keys.map((k) => {
    const row: { date: string; [key: string]: number | string } = {
      date: byDay ? k.slice(5) : formatAxisTime(k, false),
    };
    for (const [serviceId, snaps] of byService) {
      let i = ptrs.get(serviceId) ?? 0;
      while (i < snaps.length) {
        const s = snaps[i];
        const sk = byDay ? s.recordedAt.slice(0, 10) : s.recordedAt;
        if (sk > k) break;
        latest.set(serviceId, s);
        i += 1;
      }
      ptrs.set(serviceId, i);
      const l = latest.get(serviceId);
      if (l && l.balance != null) {
        row[nameOf(serviceId)] = l.balance;
      }
    }
    return row;
  });
}

export function Trends() {
  const services = useAppStore((s) => s.services);
  const snapshots = useAppStore((s) => s.snapshots);
  const loadSnapshots = useAppStore((s) => s.loadSnapshots);
  const localDailyRecords = useAppStore((s) => s.localDailyRecords);
  const loadLocalDaily = useAppStore((s) => s.loadLocalDaily);
  const range = useAppStore((s) => s.trendsRange);
  const setRange = useAppStore((s) => s.setTrendsRange);
  const tab = useAppStore((s) => s.trendsTab);
  const setTab = useAppStore((s) => s.setTrendsTab);
  const metric = useAppStore((s) => s.trendsMetric);
  const setMetric = useAppStore((s) => s.setTrendsMetric);
  const [snapReady, setSnapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSnapReady(false);
    void loadSnapshots(rangeToSince(range)).finally(() => {
      if (!cancelled) setSnapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [range, loadSnapshots]);

  // 切到本地 agent tab 或切换时间范围时加载持久化的每日历史
  useEffect(() => {
    if (tab === "local") {
      loadLocalDaily(rangeToSince(range));
    }
  }, [tab, range, loadLocalDaily]);

  const nameOf = (id: string) =>
    services.find((s) => s.id === id)?.name ?? id;

  // 按货币分组，每组一张图（不同货币不能共用 Y 轴）
  const groups = useMemo(() => {
    const byCurrency = new Map<string, BalanceSnapshot[]>();
    for (const s of snapshots) {
      if (!byCurrency.has(s.currency)) byCurrency.set(s.currency, []);
      byCurrency.get(s.currency)!.push(s);
    }
    return [...byCurrency.entries()].map(([currency, snaps]) => ({
      currency,
      data: pivot(snaps, nameOf, range !== "7d"),
      serviceNames: [...new Set(snaps.map((s) => s.serviceId))].map(nameOf),
    }));
  }, [snapshots, services, range]);

  const localChartData = useMemo(
    () => pivotDailyUsage(localDailyRecords, metric),
    [localDailyRecords, metric],
  );

  const lastScannedAt = useMemo(() => {
    let max = "";
    for (const r of localDailyRecords) {
      if (r.scannedAt && r.scannedAt > max) max = r.scannedAt;
    }
    return max || undefined;
  }, [localDailyRecords]);

  return (
    <div>
      <PageHeader
        title="趋势"
        description={
          tab === "local" && lastScannedAt
            ? `本地 agent 每日用量 · 扫描于 ${formatRelative(lastScannedAt)}`
            : "余额随时间的变化；本地 agent 每日用量趋势（每次刷新记录一点）"
        }
      >
        <Select value={range} onValueChange={(v) => setRange(v as Range)}>
          <SelectTrigger className="w-32" aria-label="时间范围">
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
      </PageHeader>

      <div className="px-8">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "balance" | "local")}
        >
          <TabsList>
            <TabsTrigger value="balance">余额趋势</TabsTrigger>
            <TabsTrigger value="local">本地 agent 用量</TabsTrigger>
          </TabsList>

          {/* ---- 余额趋势 ---- */}
          <TabsContent value="balance">
            <div className="space-y-6 py-4">
              {!snapReady ? (
                <Card>
                  <CardContent className="py-16 text-center text-sm text-muted-foreground">
                    加载中…
                  </CardContent>
                </Card>
              ) : snapshots.length === 0 ? (
                <Card>
                  <CardContent className="py-16 text-center text-sm text-muted-foreground">
                    暂无余额快照。去总览页刷新服务，刷新记录会累积成趋势数据。
                  </CardContent>
                </Card>
              ) : (
                groups.map((g) => (
                  <Card key={g.currency}>
                    <CardHeader>
                      <CardTitle className="font-display text-lg font-medium">
                        {CURRENCY_LABEL[g.currency] ?? g.currency}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {g.data.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          该范围内无数据
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={g.data} accessibilityLayer={false}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="rgba(110, 95, 70, 0.12)"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              dy={6}
                            />
                            <YAxis
                              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                              axisLine={false}
                              tickLine={false}
                              width={56}
                            />
                            <Tooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              labelStyle={{ color: "var(--popover-foreground)" }}
                              itemStyle={{ color: "var(--popover-foreground)" }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            {g.serviceNames.map((name, i) => (
                              <Line
                                key={name}
                                type="monotone"
                                dataKey={name}
                                stroke={COLORS[i % COLORS.length]}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* ---- 本地 agent 每日用量 ---- */}
          <TabsContent value="local">
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  按天聚合的本地 agent 用量。Codex 为差分精确按天，OpenCode
                  归会话创建日，Claude Code 逐条精确按天。
                  {metric === "cost" &&
                    "（费用按各自货币，不同币种混合累加仅作近似参考）"}
                </p>
                <Select
                  value={metric}
                  onValueChange={(v) => setMetric(v as Metric)}
                >
                  <SelectTrigger className="w-32" aria-label="用量指标">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tokens">Tokens/天</SelectItem>
                    <SelectItem value="cost">费用/天</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-lg font-medium">
                    本地 agent 每日{metric === "tokens" ? "用量" : "费用"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {localChartData.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      该范围内无数据。去用量页「本地 agent」tab 点「重新扫描」采集。
                    </div>
                  ) : (
                    <LocalUsageBarChart
                      data={localChartData}
                      height={300}
                      metric={metric}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
