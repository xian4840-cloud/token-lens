import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  RotateCw,
  Trash2,
  PawPrint,
} from "lucide-react";
import { DiagnosticsCard } from "@/components/DiagnosticsCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app";
import { ipc } from "@/lib/ipc";
import { showToast } from "@/lib/toast";
import { LOCAL_SOURCES } from "@/lib/local-sources";
import {
  formatBackupImportResult,
  formatBackupPreviewText,
  prepareBackupImport,
  type BackupPreview,
} from "@/lib/backup-import";
import type { ProxyMode } from "@/types";

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "关闭" },
  { value: "5", label: "每 5 分钟" },
  { value: "15", label: "每 15 分钟" },
  { value: "30", label: "每 30 分钟" },
  { value: "60", label: "每 1 小时" },
  { value: "360", label: "每 6 小时" },
  { value: "720", label: "每 12 小时" },
];

const PROXY_MODE_OPTIONS: { value: ProxyMode; label: string; desc: string }[] = [
  { value: "system", label: "跟随系统代理", desc: "自动读取操作系统代理设置与环境变量" },
  { value: "custom", label: "自定义代理", desc: "手动指定 HTTP(S) 或 SOCKS5 代理地址" },
  { value: "direct", label: "直连 (不使用代理)", desc: "所有网络请求直接连接远端服务器" },
];

const TIMEOUT_OPTIONS: { value: string; label: string }[] = [
  { value: "10", label: "10 秒" },
  { value: "15", label: "15 秒 (推荐)" },
  { value: "30", label: "30 秒" },
  { value: "60", label: "60 秒" },
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

/** 网络与代理：模式、超时、自定义代理、旁路规则与连通性测试 */
function NetworkProxySection() {
  const proxyMode = useAppStore((s) => s.proxyMode);
  const proxyCustomUrl = useAppStore((s) => s.proxyCustomUrl);
  const proxyBypassRules = useAppStore((s) => s.proxyBypassRules);
  const requestTimeout = useAppStore((s) => s.requestTimeout);
  const proxyTesting = useAppStore((s) => s.proxyTesting);
  const proxyTestResult = useAppStore((s) => s.proxyTestResult);

  const saveProxyMode = useAppStore((s) => s.saveProxyMode);
  const saveProxyCustomUrl = useAppStore((s) => s.saveProxyCustomUrl);
  const saveProxyBypassRules = useAppStore((s) => s.saveProxyBypassRules);
  const saveRequestTimeout = useAppStore((s) => s.saveRequestTimeout);
  const testProxy = useAppStore((s) => s.testProxy);

  const [customUrlInput, setCustomUrlInput] = useState(proxyCustomUrl);
  const [bypassInput, setBypassInput] = useState(proxyBypassRules);
  const [showAdvancedBypass, setShowAdvancedBypass] = useState(false);
  const [testedAt, setTestedAt] = useState<string | null>(null);

  useEffect(() => {
    setCustomUrlInput(proxyCustomUrl);
  }, [proxyCustomUrl]);

  useEffect(() => {
    setBypassInput(proxyBypassRules);
  }, [proxyBypassRules]);

  const handleCustomUrlBlur = () => {
    if (customUrlInput !== proxyCustomUrl) {
      void saveProxyCustomUrl(customUrlInput.trim());
    }
  };

  const handleBypassBlur = () => {
    if (bypassInput !== proxyBypassRules) {
      void saveProxyBypassRules(bypassInput.trim());
    }
  };

  const handleRunTest = () => {
    void testProxy({
      mode: proxyMode,
      customUrl: customUrlInput.trim(),
      bypassRules: bypassInput.trim(),
    })
      .then(() => {
        setTestedAt(new Date().toLocaleTimeString());
      })
      .catch(() => {
        setTestedAt(new Date().toLocaleTimeString());
      });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-display text-lg font-medium flex items-center gap-2">
              <Globe className="size-5 text-primary" />
              网络与代理
            </CardTitle>
            <CardDescription>
              配置 API 请求与内嵌登录窗口的代理模式，国内厂商默认智能直连分流。
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunTest}
            disabled={proxyTesting}
            className="gap-1.5"
          >
            {proxyTesting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                正在测试...
              </>
            ) : (
              <>
                <RotateCw className="size-3.5" />
                测试连接
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 代理模式选择 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <span className="text-sm font-medium">代理工作模式</span>
            <Select value={proxyMode} onValueChange={(v) => saveProxyMode(v as ProxyMode)}>
              <SelectTrigger className="w-full" aria-label="代理工作模式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROXY_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <div>
                      <div>{o.label}</div>
                      <div className="text-xs text-muted-foreground">{o.desc}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted-foreground" />
              请求超时时间
            </span>
            <Select value={requestTimeout} onValueChange={(v) => saveRequestTimeout(v)}>
              <SelectTrigger className="w-full" aria-label="请求超时时间">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEOUT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 自定义代理输入框 */}
        {proxyMode === "custom" && (
          <div className="space-y-2 rounded-lg border border-border/80 bg-accent/20 p-4">
            <label className="text-sm font-medium">代理服务器地址</label>
            <div className="flex gap-2">
              <Input
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
                onBlur={handleCustomUrlBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomUrlBlur();
                }}
                placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:10808"
                className="font-mono text-sm"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCustomUrlBlur}
                className="shrink-0"
              >
                应用
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              支持 HTTP、HTTPS 与 SOCKS5 代理协议（例如 <code>http://127.0.0.1:7890</code> 或{" "}
              <code>socks5://127.0.0.1:10808</code>）。
            </p>
          </div>
        )}

        {/* 智能分流与旁路说明 */}
        <div className="rounded-lg border border-border/60 bg-accent/10 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="success" className="text-[11px] font-normal">
                智能分流已启用
              </Badge>
              <span className="text-xs text-muted-foreground">
                火山方舟、阿里云百炼、硅基流动、Kimi、DeepSeek 等国内服务及 <code>*.cn</code>{" "}
                自动直连旁路。
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedBypass(!showAdvancedBypass)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              <SlidersHorizontal className="size-3" />
              高级规则
              {showAdvancedBypass ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>
          </div>

          {showAdvancedBypass && (
            <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
              <span className="text-xs font-medium">直连旁路域名列表 (Bypass List)</span>
              <Input
                value={bypassInput}
                onChange={(e) => setBypassInput(e.target.value)}
                onBlur={handleBypassBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleBypassBlur();
                }}
                className="font-mono text-xs"
                placeholder="<local>,*.cn,*.aliyuncs.com,*.volcengineapi.com..."
              />
              <p className="text-[11px] text-muted-foreground">
                以逗号分隔，支持通配符（如 <code>*.cn</code>、<code>*.volcengine.com</code>）。
              </p>
            </div>
          )}
        </div>

        {/* 连通性测试结果面板 */}
        {proxyTestResult && (
          <div className="space-y-2.5 rounded-lg border border-border/80 bg-background/80 p-4">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>连通性探测结果</span>
              <span>{testedAt}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {proxyTestResult.targets.map((target) => (
                <div
                  key={target.name}
                  className="flex items-center justify-between rounded-md border border-border/50 bg-accent/20 px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    {target.ok ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="size-3.5 shrink-0 text-destructive" />
                    )}
                    <span className="font-medium truncate">{target.name}</span>
                  </div>
                  <div className="shrink-0 pl-2">
                    {target.ok ? (
                      <Badge
                        variant={target.latencyMs < 600 ? "success" : "warning"}
                        className="font-mono text-[11px] h-5 px-1.5"
                      >
                        {target.latencyMs}ms
                      </Badge>
                    ) : (
                      <span
                        className="text-[11px] text-destructive max-w-[110px] truncate block"
                        title={target.error}
                      >
                        {target.error || "失败"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 数据目录、备份导出与导入 */
function DataBackupSection() {
  const [backingUp, setBackingUp] = useState(false);
  const [backupPending, setBackupPending] = useState<{
    raw: string;
    preview: BackupPreview;
  } | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-medium">数据与日志</CardTitle>
          <CardDescription>
            配置、密钥密文和用量历史都在本机 userData 目录，不会上传。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void ipc.revealUserData()}>
            打开数据目录
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={backingUp}
            onClick={() => {
              setBackingUp(true);
              void (async () => {
                try {
                  const json = await ipc.backupJson();
                  const ok = await ipc.saveText(
                    `token-lens-backup-${new Date().toISOString().slice(0, 10)}.json`,
                    json,
                  );
                  if (ok) showToast("备份已导出（不含密钥）");
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "导出失败", "err");
                } finally {
                  setBackingUp(false);
                }
              })();
            }}
          >
            {backingUp ? "导出中…" : "导出备份"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                const r = await prepareBackupImport();
                if (!r.ok) {
                  if ("error" in r) showToast(r.error, "err");
                  return;
                }
                setBackupPending({ raw: r.raw, preview: r.preview });
              })();
            }}
          >
            导入备份
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            备份含服务清单、用量历史和价格覆盖，不含 API Key、Cookie 和代理地址。导入不会写入密钥。
          </p>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={backupPending != null}
        onOpenChange={(open) => {
          if (!open) setBackupPending(null);
        }}
        title="导入备份？"
        description={backupPending ? formatBackupPreviewText(backupPending.preview) : "导入备份"}
        confirmLabel="导入"
        onConfirm={() => {
          const pending = backupPending;
          setBackupPending(null);
          if (!pending) return;
          void ipc.importBackup(pending.raw).then(
            (r) => {
              showToast(formatBackupImportResult(r));
              void useAppStore.getState().reloadAfterBackupImport();
            },
            (e: unknown) => showToast(e instanceof Error ? e.message : "导入失败", "err"),
          );
        }}
      />
    </>
  );
}

/** 本地用量缓存清理 */
function LocalCacheSection() {
  const [clearingCache, setClearingCache] = useState(false);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearCacheMessage, setClearCacheMessage] = useState<string | null>(null);

  const handleClearCache = async () => {
    setClearingCache(true);
    setClearCacheMessage(null);
    try {
      const result = await ipc.clearLocalUsageCache();
      if (result.success) {
        setClearCacheMessage("缓存已清除，并重新扫描了用量数据。");
        showToast("缓存已清除并重新扫描");
      } else {
        setClearCacheMessage(`清除失败：${result.error || "未知错误"}`);
        showToast(result.error || "清除失败", "err");
      }
      setClearCacheOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setClearCacheMessage(`清除失败：${msg}`);
      showToast(msg, "err");
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-medium">本地用量缓存</CardTitle>
          <CardDescription>
            清除缓存后会重新扫描所有 agent 会话记录。如果发现统计数据异常，可以尝试清除缓存。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setClearCacheMessage(null);
              setClearCacheOpen(true);
            }}
            disabled={clearingCache}
            className="gap-1.5"
          >
            {clearingCache ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                清除中...
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" />
                清除缓存并重新扫描
              </>
            )}
          </Button>
          {clearCacheMessage ? (
            <p className="mt-3 text-xs text-muted-foreground">{clearCacheMessage}</p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              注意：此操作会清空所有历史统计记录，重新扫描可能需要几秒到几分钟（取决于会话文件数量）。
            </p>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={clearCacheOpen}
        onOpenChange={setClearCacheOpen}
        title="清除本地用量缓存？"
        description="将删除所有缓存数据和历史统计记录，然后重新扫描。此操作不可撤销。"
        confirmLabel="清除并重扫"
        destructive
        busy={clearingCache}
        onConfirm={handleClearCache}
      />
    </>
  );
}
