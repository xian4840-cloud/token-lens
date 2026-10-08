import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, PawPrint } from "lucide-react";
import { DiagnosticsCard } from "@/components/DiagnosticsCard";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import { LOCAL_SOURCES } from "@/lib/local-sources";
import { DataBackupSection } from "./DataBackupSection";
import { LocalCacheSection } from "./LocalCacheSection";
import { NetworkProxySection } from "./NetworkProxySection";

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "关闭" },
  { value: "5", label: "每 5 分钟" },
  { value: "15", label: "每 15 分钟" },
  { value: "30", label: "每 30 分钟" },
  { value: "60", label: "每 1 小时" },
  { value: "360", label: "每 6 小时" },
  { value: "720", label: "每 12 小时" },
];

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="设置" description="自动刷新间隔、网络与代理、模型价格表等" />
      <div className="space-y-6 px-8 pb-12">
        {/* 自动刷新 */}
        <AutoRefreshSection />

        <PetSection />

        <LocalSourcesSection />

        <BudgetSection />

        {/* 网络与代理配置 */}
        <NetworkProxySection />

        <DataBackupSection />

        {/* 诊断日志 */}
        <DiagnosticsCard />

        {/* 本地用量缓存清理 */}
        <LocalCacheSection />

        {/* 模型价格表入口卡片 */}
        <Link to="/settings/pricing" className="block">
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent/40 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_40px_rgba(90,75,50,0.14)]">
            <CardContent className="flex items-center justify-between py-4">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">模型价格表</div>
                <div className="text-xs text-muted-foreground">
                  各模型 token 单价，用于本地 agent 用量换算费用
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

/** 自动刷新间隔 */
function AutoRefreshSection() {
  const refreshInterval = useAppStore((s) => s.refreshInterval);
  const saveRefreshInterval = useAppStore((s) => s.saveRefreshInterval);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-medium">自动刷新</CardTitle>
        <CardDescription>
          应用打开时定时刷新所有服务余额并记录到趋势。关闭应用即停止，不做后台常驻。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">刷新间隔</span>
          <Select value={refreshInterval} onValueChange={(v) => saveRefreshInterval(Number(v))}>
            <SelectTrigger className="w-44" aria-label="刷新间隔">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVAL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

/** 桌面宠物开关 */
function PetSection() {
  const petEnabled = useAppStore((s) => s.petEnabled);
  const savePetEnabled = useAppStore((s) => s.savePetEnabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-medium flex items-center gap-2">
          <PawPrint className="size-5 text-primary" />
          桌面宠物
        </CardTitle>
        <CardDescription>
          开启后桌面上会出现一只可拖动的小雷姆，本地 agent 在干活时她会跟着忙。点击她显示今日本地
          agent 的花费估算。关闭本应用时宠物一起关掉。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">显示宠物</span>
          <Select
            value={petEnabled ? "1" : "0"}
            onValueChange={(v) => void savePetEnabled(v === "1")}
          >
            <SelectTrigger className="w-44" aria-label="显示宠物">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">关闭</SelectItem>
              <SelectItem value="1">开启</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

/** 本地采集来源开关（存 setting `disabledLocalSources`） */
function LocalSourcesSection() {
  const [disabledSources, setDisabledSources] = useState<string[]>([]);

  useEffect(() => {
    void ipc
      .getSetting("disabledLocalSources")
      .then((raw) => {
        try {
          const v: unknown = JSON.parse(raw || "[]");
          if (Array.isArray(v)) {
            setDisabledSources(v.filter((x) => typeof x === "string"));
            return;
          }
          showToast("本地来源开关数据损坏，已按全部开启处理", "err");
          setDisabledSources([]);
        } catch {
          showToast("本地来源开关数据损坏，已按全部开启处理", "err");
          setDisabledSources([]);
        }
      })
      .catch((e: unknown) => {
        showToast(e instanceof Error ? e.message : "读取来源开关失败", "err");
      });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-medium">本地采集来源</CardTitle>
        <CardDescription>
          关掉的来源不再扫描，已有历史还在。适合某家 agent 目录特别大、又不想统计的时候。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {LOCAL_SOURCES.map((s) => {
          const on = !disabledSources.includes(s.value);
          return (
            <Button
              key={s.value}
              type="button"
              size="sm"
              variant={on ? "secondary" : "outline"}
              onClick={() => {
                const next = on
                  ? [...disabledSources, s.value]
                  : disabledSources.filter((x) => x !== s.value);
                const prev = disabledSources;
                setDisabledSources(next);
                void ipc
                  .setSetting("disabledLocalSources", JSON.stringify(next))
                  .then(() => showToast(on ? `已关闭 ${s.label}` : `已开启 ${s.label}`))
                  .catch((e: unknown) => {
                    setDisabledSources(prev);
                    showToast(e instanceof Error ? e.message : "保存来源开关失败", "err");
                  });
              }}
            >
              {s.label}
              {on ? "" : "（关）"}
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** 月度预算 */
function BudgetSection() {
  const monthlyBudgetUsd = useAppStore((s) => s.monthlyBudgetUsd);
  const saveMonthlyBudgetUsd = useAppStore((s) => s.saveMonthlyBudgetUsd);

  const [budgetInput, setBudgetInput] = useState(monthlyBudgetUsd);

  useEffect(() => {
    setBudgetInput(monthlyBudgetUsd);
  }, [monthlyBudgetUsd]);

  const handleBudgetBlur = () => {
    const next = budgetInput.trim();
    if (next === monthlyBudgetUsd) return;
    void saveMonthlyBudgetUsd(next)
      .then(() => showToast("月度预算已保存"))
      .catch(() => {
        setBudgetInput(monthlyBudgetUsd);
        showToast("月度预算无效", "err");
      });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-medium">月度预算</CardTitle>
        <CardDescription>
          按本月本地 agent 花费估算盯预算，总览卡片上会画出进度。留空表示不限制。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">每月上限 (USD)</span>
          <Input
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            onBlur={handleBudgetBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleBudgetBlur();
            }}
            placeholder="不限制"
            className="w-36 font-mono"
            inputMode="decimal"
          />
        </div>
      </CardContent>
    </Card>
  );
}
