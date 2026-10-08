import { useEffect, useMemo, useState } from "react";
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
import { Bot, Coins, ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/app";
import { LocalUsageBarChart } from "@/components/LocalUsageBarChart";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import { copyText } from "@/lib/copy-text";
import { applyLocalUsageCsv, toCsv, type LocalCsvRow } from "@/lib/csv";
import { pickTextFile, readFileAsText } from "@/lib/pick-file";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  formatCost,
  formatDateKey,
  formatRelative,
  formatTime,
  formatTokensCn,
  visibleTokens,
} from "@/lib/format";
import {
  LOCAL_SOURCES,
  LOCAL_SOURCE_LABEL as SOURCE_LABEL,
  pivotDailyUsage,
  summarizeLocalRecords,
} from "@/lib/local-sources";
import type {
  LocalDailyUsageRecord,
  LocalSource,
  ScanLocalUsageResult,
  ServiceRecord,
  UsageRecord,
} from "@/types";

type Range = "month" | "7d" | "30d" | "all";

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: "month", label: "当月" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

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

export function Usage() {
  const services = useAppStore((s) => s.services);
  const definitions = useAppStore((s) => s.definitions);
  const usageRecords = useAppStore((s) => s.usageRecords);
  const usageRefreshing = useAppStore((s) => s.usageRefreshing);
  const errors = useAppStore((s) => s.errors);
  const loadUsage = useAppStore((s) => s.loadUsage);
  const refreshAllUsage = useAppStore((s) => s.refreshAllUsage);

  const localUsageUnavailable = useAppStore((s) => s.localUsageUnavailable);
  const localUsageScanning = useAppStore((s) => s.localUsageScanning);
  const scanLocalUsage = useAppStore((s) => s.scanLocalUsage);
  const localDailyRecords = useAppStore((s) => s.localDailyRecords);
  const loadLocalDaily = useAppStore((s) => s.loadLocalDaily);

  const range = useAppStore((s) => s.usageRange);
  const setRange = useAppStore((s) => s.setUsageRange);
  const tab = useAppStore((s) => s.usageTab);
  const setTab = useAppStore((s) => s.setUsageTab);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [usageReady, setUsageReady] = useState(
    () => useAppStore.getState().usageRecords.length > 0,
  );
  const [localReady, setLocalReady] = useState(
    () => useAppStore.getState().localDailyRecords.length > 0,
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [localSource, setLocalSource] = useState<"all" | LocalSource>("all");
  const [csvPending, setCsvPending] = useState<{
    rows: LocalCsvRow[];
    unknownSources: string[];
    invalid: string[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (useAppStore.getState().usageRecords.length === 0) setUsageReady(false);
    void loadUsage(rangeToSince(range)).finally(() => {
      if (!cancelled) setUsageReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [range, loadUsage]);

  // 切到本地 agent tab 或切换时间范围时加载持久化的每日历史
  useEffect(() => {
    if (tab !== "local") return;
    let cancelled = false;
    setLocalReady(false);
    void loadLocalDaily(rangeToSince(range)).finally(() => {
      if (!cancelled) setLocalReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, range, loadLocalDaily]);

  const nameOf = (id: string) => services.find((s) => s.id === id)?.name ?? id.slice(0, 8);

  const supportedProviders = useMemo(
    () => new Set(definitions.filter((d) => d.supportsUsage).map((d) => d.provider)),
    [definitions],
  );

  const unsupportedServices = services.filter((s) => !supportedProviders.has(s.provider));
  const supportedServices = services.filter((s) => supportedProviders.has(s.provider));

  const refreshErrors = supportedServices
    .map((s) => ({ name: s.name, msg: errors[s.id] }))
    .filter((e) => e.msg);

  const exportApi = async () => {
    const csv = toCsv(
      ["服务", "模型", "Tokens", "费用", "币种", "周期", "记录时间"],
      records.map((r) => [
        nameOf(r.serviceId),
        r.model,
        r.totalTokens,
        r.cost,
        r.currency,
        r.period,
        r.recordedAt,
      ]),
    );
    setExportError(null);
    try {
      const ok = await ipc.saveText(`token-lens-api-${range}.csv`, csv);
      if (!ok) return;
      showToast("已导出 CSV");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(msg);
      showToast(msg, "err");
    }
  };

  const exportLocal = async () => {
    const csv = toCsv(
      ["日期", "来源", "模型", "会话", "输入", "输出", "缓存写", "缓存读", "推理", "费用", "币种"],
      localRows.map((r) => [
        r.date,
        r.source,
        r.model,
        r.sessions,
        r.inputTokens,
        r.outputTokens,
        r.cacheCreationTokens,
        r.cacheReadTokens,
        r.reasoningTokens,
        r.cost,
        r.currency,
      ]),
    );
    setExportError(null);
    try {
      const ok = await ipc.saveText(`token-lens-local-${range}.csv`, csv);
      if (!ok) return;
      showToast("已导出 CSV");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(msg);
      showToast(msg, "err");
    }
  };

  const handleRefresh = async () => {
    if (range === "all") return;
    await refreshAllUsage(rangeToPeriod(range));
    await loadUsage(rangeToSince(range));
  };

  const records = useMemo(
    () => [...usageRecords].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [usageRecords],
  );

  // 本地每日明细：按日期倒序，同日按来源+模型
  const filteredDaily = useMemo(
    () =>
      localSource === "all"
        ? localDailyRecords
        : localDailyRecords.filter((r) => r.source === localSource),
    [localDailyRecords, localSource],
  );

  const localRows = useMemo(
    () =>
      [...filteredDaily].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          a.source.localeCompare(b.source) ||
          a.model.localeCompare(b.model),
      ),
    [filteredDaily],
  );

  // 按日期分组
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, typeof localRows>();
    for (const row of localRows) {
      const existing = groups.get(row.date) ?? [];
      existing.push(row);
      groups.set(row.date, existing);
    }
    return groups;
  }, [localRows]);

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const dailyChartData = useMemo(() => pivotDailyUsage(filteredDaily), [filteredDaily]);

  const lastScannedAt = useMemo(() => {
    let max = "";
    for (const r of filteredDaily) {
      if (r.scannedAt && r.scannedAt > max) max = r.scannedAt;
    }
    return max || undefined;
  }, [filteredDaily]);

  return (
    <div>
      <PageHeader
        title="用量明细"
        description={
          tab === "local" && lastScannedAt
            ? `本地扫描 ${formatRelative(lastScannedAt)} · 总量含缓存读取，不把缓存再算进输入`
            : "跨服务按模型汇总的用量与支出；本地 agent 按天扫描本机使用记录换算。总量含缓存读取，但不把缓存再算进输入。"
        }
      />

      <div className="px-8">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "api" | "local")}>
          <div className="flex items-center justify-between py-4">
            <TabsList>
              <TabsTrigger value="api">API 用量</TabsTrigger>
              <TabsTrigger value="local">本地 agent</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
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
              {tab === "api" ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void exportApi()}
                    disabled={!usageReady || records.length === 0}
                  >
                    导出 CSV
                  </Button>
                  <Button
                    onClick={handleRefresh}
                    disabled={range === "all" || usageRefreshing || supportedServices.length === 0}
                  >
                    {usageRefreshing ? "刷新中…" : "刷新用量"}
                  </Button>
                </>
              ) : (
                <>
                  <Select
                    value={localSource}
                    onValueChange={(v) => setLocalSource(v as "all" | LocalSource)}
                  >
                    <SelectTrigger className="w-36" aria-label="筛选来源">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部来源</SelectItem>
                      {LOCAL_SOURCES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    onClick={() => void exportLocal()}
                    disabled={!localReady || localRows.length === 0}
                  >
                    导出 CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        const file = await pickTextFile(".csv,text/csv");
                        if (!file) return;
                        const read = await readFileAsText(file);
                        if (!read.ok) {
                          showToast(read.error, "err");
                          return;
                        }
                        const parsed = applyLocalUsageCsv(read.text);
                        if (!parsed.ok) {
                          showToast(parsed.error, "err");
                          return;
                        }
                        if (parsed.rows.length === 0) {
                          const notes = [
                            parsed.unknownSources.length
                              ? `未知来源 ${parsed.unknownSources.length}`
                              : "",
                            parsed.invalid.length ? `非法 ${parsed.invalid.length} 行` : "",
                          ]
                            .filter(Boolean)
                            .join("，");
                          showToast(notes ? `没有可导入的行（${notes}）` : "没有可导入的行", "err");
                          return;
                        }
                        setCsvPending({
                          rows: parsed.rows,
                          unknownSources: parsed.unknownSources,
                          invalid: parsed.invalid,
                        });
                      })();
                    }}
                  >
                    导入 CSV
                  </Button>
                  <Button
                    onClick={() => {
                      void scanLocalUsage(rangeToSince(range)).then(undefined, (e: unknown) =>
                        showToast(e instanceof Error ? e.message : "扫描失败", "err"),
                      );
                    }}
                    disabled={localUsageScanning}
                  >
                    {localUsageScanning ? "扫描中…" : "重新扫描"}
                  </Button>
                </>
              )}
            </div>
          </div>
          {exportError ? <p className="pb-3 text-xs text-destructive">{exportError}</p> : null}

          {/* ---- API 用量 ---- */}
          <TabsContent value="api">
            <ApiUsagePanel
              unsupportedServices={unsupportedServices}
              supportedServices={supportedServices}
              refreshErrors={refreshErrors}
              usageReady={usageReady}
              records={records}
              nameOf={nameOf}
            />
          </TabsContent>

          {/* ---- 本地 agent ---- */}
          <TabsContent value="local">
            <LocalUsagePanel
              localUsageUnavailable={localUsageUnavailable}
              localReady={localReady}
              localRows={localRows}
              localUsageScanning={localUsageScanning}
              dailyChartData={dailyChartData}
              groupedByDate={groupedByDate}
              expandedDates={expandedDates}
              setExpandedDates={setExpandedDates}
              toggleDate={toggleDate}
            />
          </TabsContent>
        </Tabs>
      </div>
      <ConfirmDialog
        open={csvPending != null}
        onOpenChange={(open) => {
          if (!open) setCsvPending(null);
        }}
        title="导入本地用量 CSV？"
        description={
          csvPending
            ? `将写入 ${csvPending.rows.length} 条日桶${
                csvPending.unknownSources.length || csvPending.invalid.length
                  ? `（跳过未知来源 ${csvPending.unknownSources.length}、非法 ${csvPending.invalid.length} 行）`
                  : ""
              }。未知价格不会被写成 $0。`
            : "导入 CSV"
        }
        confirmLabel="导入"
        onConfirm={() => {
          const pending = csvPending;
          setCsvPending(null);
          if (!pending) return;
          void (async () => {
            try {
              const r = await ipc.importLocalRows(pending.rows);
              await loadLocalDaily(rangeToSince(range));
              showToast(`已导入 ${r.imported} 条`);
            } catch (e) {
              showToast(e instanceof Error ? e.message : "导入失败", "err");
            }
          })();
        }}
      />
    </div>
  );
}

/** API 用量 tab 的内容；数据与派生值都由页面传入，本身不持有状态 */
function ApiUsagePanel({
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

/** 本地 agent tab 的内容；展开状态留在页面里，切 tab 回来不丢 */
function LocalUsagePanel({
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
