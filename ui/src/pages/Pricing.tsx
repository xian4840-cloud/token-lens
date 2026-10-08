import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { applyPricingCsv, toCsv } from "@/lib/csv";
import { showToast } from "@/lib/toast";
import { pickTextFile, readFileAsText } from "@/lib/pick-file";
import { applySearchEscape } from "@/lib/search-escape";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ModelPricing, PricingRowDisplay } from "@/types";

type NumericField = "inputPerM" | "outputPerM" | "cacheReadPerM" | "cacheWritePerM";

export function PricingPage() {
  const navigate = useNavigate();
  const pricingTable = useAppStore((s) => s.pricingTable);
  const loadPricing = useAppStore((s) => s.loadPricing);
  const savePricing = useAppStore((s) => s.savePricing);
  const [draft, setDraft] = useState<PricingRowDisplay[]>(pricingTable);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [csvPending, setCsvPending] = useState<{
    rows: PricingRowDisplay[];
    applied: number;
    notes: string[];
  } | null>(null);

  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return draft;
    return draft.filter(
      (r) => r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q),
    );
  }, [draft, query]);

  useEffect(() => {
    void loadPricing().then(undefined, (e: unknown) =>
      showToast(e instanceof Error ? e.message : "加载价格表失败", "err"),
    );
  }, [loadPricing]);

  // store 加载完成后同步到本地草稿；保存后也会经此重置 dirty
  useEffect(() => {
    setDraft(pricingTable);
    setDirty(false);
  }, [pricingTable]);

  const update = (key: string, field: NumericField, value: string) => {
    setDraft((rows) =>
      rows.map((r) =>
        r.key === key
          ? { ...r, [field]: value === "" ? 0 : Number(value) }
          : r,
      ),
    );
    setDirty(true);
  };

  const restoreRow = (key: string) => {
    setDraft((rows) =>
      rows.map((r) =>
        r.key === key && r.defaults
          ? {
              ...r,
              inputPerM: r.defaults.inputPerM,
              outputPerM: r.defaults.outputPerM,
              cacheReadPerM: r.defaults.cacheReadPerM,
              cacheWritePerM: r.defaults.cacheWritePerM,
              overridden: false,
            }
          : r,
      ),
    );
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const overrides: Record<string, Partial<ModelPricing>> = {};
      for (const r of draft) {
        overrides[r.key] = {
          inputPerM: r.inputPerM,
          outputPerM: r.outputPerM,
          cacheReadPerM: r.cacheReadPerM,
          cacheWritePerM: r.cacheWritePerM,
        };
      }
      await savePricing(overrides);
      showToast("价格表已保存");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "保存失败", "err");
    } finally {
      setSaving(false);
    }
  };

  const handleImportCsv = () => {
    void (async () => {
      const file = await pickTextFile(".csv,text/csv");
      if (!file) return;
      const read = await readFileAsText(file);
      if (!read.ok) {
        showToast(read.error, "err");
        return;
      }
      const result = applyPricingCsv(draft, read.text);
      if (!result.ok) {
        showToast(result.error, "err");
        return;
      }
      const notes: string[] = [];
      if (result.unknownKeys.length > 0) {
        notes.push(`未识别 ${result.unknownKeys.length} 个模型`);
      }
      if (result.invalid.length > 0) {
        notes.push(`${result.invalid.length} 行数字无效`);
      }
      if (result.applied === 0) {
        showToast(
          notes.length > 0
            ? `没有可导入的改动（${notes.join("，")}）`
            : "没有可导入的改动",
          "err",
        );
        return;
      }
      setCsvPending({ rows: result.rows, applied: result.applied, notes });
    })();
  };

  return (
    <div>
      <PageHeader
        title="模型价格表"
        description="各模型 token 单价（USD/百万 tokens），用于本地 agent 用量换算费用"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const csv = toCsv(
                ["key", "label", "inputPerM", "outputPerM", "cacheReadPerM", "cacheWritePerM", "overridden"],
                draft.map((r) => [
                  r.key,
                  r.label,
                  r.inputPerM,
                  r.outputPerM,
                  r.cacheReadPerM,
                  r.cacheWritePerM,
                  r.overridden ? "1" : "0",
                ]),
              );
              void ipc
                .saveText("token-lens-pricing.csv", csv)
                .then((ok) => {
                  if (ok) showToast("价格表已导出");
                })
                .catch((e: unknown) =>
                  showToast(e instanceof Error ? e.message : "导出失败", "err"),
                );
            }}
          >
            导出 CSV
          </Button>
          <Button variant="outline" onClick={handleImportCsv} disabled={draft.length === 0}>
            导入 CSV
          </Button>
          <Button variant="ghost" onClick={() => navigate("/settings")}>
            <ArrowLeft className="size-4" />
            返回
          </Button>
        </div>
      </PageHeader>

      {blocker.state === "blocked" ? (
        <div className="mx-8 mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
          <span>有未保存的价格改动，确定离开？</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => blocker.reset()}>
              留下
            </Button>
            <Button size="sm" onClick={() => blocker.proceed()}>
              离开
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 px-8">
        {draft.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              加载价格表中…
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg font-medium">价格明细</CardTitle>
              <CardDescription>
                改完点保存生效。内置价格照各家官方定价页录入，核对日期
                2026-09-04，此后厂商调价不会自动同步，请以官网为准。
                取标准档非折扣价；分档定价（长短上下文、峰谷时段）取常用档。
                只保存你改动过的行，其余仍跟随版本更新。
              </CardDescription>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型…"
                onKeyDown={(e) => applySearchEscape(e, query, () => setQuery(""))}
                aria-label="搜索模型"
                className="mt-3 max-w-xs"
              />
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium">模型</th>
                      <th className="px-2 py-2 text-right font-medium">输入</th>
                      <th className="px-2 py-2 text-right font-medium">输出</th>
                      <th className="px-2 py-2 text-right font-medium">缓存命中</th>
                      <th className="px-2 py-2 text-right font-medium">缓存创建</th>
                      <th className="px-2 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-8 text-center text-sm text-muted-foreground">
                          无匹配模型
                        </td>
                      </tr>
                    ) : null}
                    {visible.map((r) => (
                      <tr key={r.key} className="border-b border-border/60 transition-colors last:border-0 hover:bg-white/30">
                        <td className="px-2 py-2 whitespace-nowrap">{r.label}</td>
                        <td className="px-2 py-2 text-right">
                          <PriceInput
                            value={r.inputPerM}
                            onChange={(v) => update(r.key, "inputPerM", v)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <PriceInput
                            value={r.outputPerM}
                            onChange={(v) => update(r.key, "outputPerM", v)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <PriceInput
                            value={r.cacheReadPerM}
                            onChange={(v) => update(r.key, "cacheReadPerM", v)}
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <PriceInput
                            value={r.cacheWritePerM}
                            onChange={(v) => update(r.key, "cacheWritePerM", v)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {r.defaults &&
                          (r.overridden ||
                            r.inputPerM !== r.defaults.inputPerM ||
                            r.outputPerM !== r.defaults.outputPerM ||
                            r.cacheReadPerM !== r.defaults.cacheReadPerM ||
                            r.cacheWritePerM !== r.defaults.cacheWritePerM) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => restoreRow(r.key)}
                            >
                              恢复默认
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? "保存中…" : "保存"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={csvPending != null}
        onOpenChange={(open) => {
          if (!open) setCsvPending(null);
        }}
        title="导入价格表 CSV？"
        description={
          csvPending
            ? `将套用 ${csvPending.applied} 行到草稿${
                csvPending.notes.length ? `（${csvPending.notes.join("，")}）` : ""
              }。点保存才写入。未知模型不会被加成 $0。`
            : "导入 CSV"
        }
        confirmLabel="套用"
        onConfirm={() => {
          const pending = csvPending;
          setCsvPending(null);
          if (!pending) return;
          setDraft(pending.rows);
          setDirty(true);
          showToast(`已套用 ${pending.applied} 行，点保存生效`);
        }}
      />
    </div>
  );
}

function PriceInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const bump = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    if (dir > 0) el.stepUp();
    else el.stepDown();
    onChange(el.value);
  };
  return (
    <div className="relative inline-flex items-center">
      <Input
        ref={ref}
        type="number"
        step="0.0001"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-24 pr-7 text-right"
      />
      <div className="absolute right-0.5 top-1/2 flex -translate-y-1/2 flex-col items-center">
        <button
          type="button"
          onClick={() => bump(1)}
          aria-label="增大"
          className="bg-transparent p-0 leading-none text-muted-foreground hover:text-foreground"
        >
          <ChevronUp className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => bump(-1)}
          aria-label="减小"
          className="bg-transparent p-0 leading-none text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}
