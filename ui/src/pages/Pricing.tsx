import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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

  useEffect(() => {
    void loadPricing();
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="模型价格表"
        description="各模型 token 单价（USD/百万 tokens），用于本地 agent 用量换算费用"
      >
        <Button variant="ghost" onClick={() => navigate("/settings")}>
          <ArrowLeft className="size-4" />
          返回
        </Button>
      </PageHeader>

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
                改完点保存生效。价格可能滞后，请以官网为准。
              </CardDescription>
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
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((r) => (
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
