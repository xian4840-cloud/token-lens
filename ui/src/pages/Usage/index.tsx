import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import { applyLocalUsageCsv, toCsv, type LocalCsvRow } from "@/lib/csv";
import { pickTextFile, readFileAsText } from "@/lib/pick-file";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatRelative } from "@/lib/format";
import { LOCAL_SOURCES, pivotDailyUsage } from "@/lib/local-sources";
import type { LocalSource } from "@/types";
import { ApiUsagePanel } from "./ApiUsagePanel";
import { LocalUsagePanel } from "./LocalUsagePanel";

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
