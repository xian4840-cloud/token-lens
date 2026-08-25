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
} from "lucide-react";
import { DiagnosticsCard } from "@/components/DiagnosticsCard";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/app";
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
  const refreshInterval = useAppStore((s) => s.refreshInterval);
  const saveRefreshInterval = useAppStore((s) => s.saveRefreshInterval);

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

  const loaded = useAppStore((s) => s.loaded);
  const init = useAppStore((s) => s.init);

  const [customUrlInput, setCustomUrlInput] = useState(proxyCustomUrl);
  const [bypassInput, setBypassInput] = useState(proxyBypassRules);
  const [showAdvancedBypass, setShowAdvancedBypass] = useState(false);

  useEffect(() => {
    if (!loaded) init();
  }, [loaded, init]);

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
    });
  };

  return (
    <div>
      <PageHeader title="设置" description="自动刷新间隔、网络与代理、模型价格表等" />
      <div className="space-y-6 px-8 pb-12">
        {/* 自动刷新 */}
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
              <Select
                value={refreshInterval}
                onValueChange={(v) => saveRefreshInterval(Number(v))}
              >
                <SelectTrigger className="w-44">
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

        {/* 网络与代理配置 */}
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
                <Select
                  value={proxyMode}
                  onValueChange={(v) => saveProxyMode(v as ProxyMode)}
                >
                  <SelectTrigger className="w-full">
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
                <Select
                  value={requestTimeout}
                  onValueChange={(v) => saveRequestTimeout(v)}
                >
                  <SelectTrigger className="w-full">
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
                  支持 HTTP、HTTPS 与 SOCKS5 代理协议（例如 <code>http://127.0.0.1:7890</code> 或 <code>socks5://127.0.0.1:10808</code>）。
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
                    火山方舟、阿里云百炼、硅基流动、Kimi、DeepSeek 等国内服务及 <code>*.cn</code> 自动直连旁路。
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
                  <span>{new Date().toLocaleTimeString()}</span>
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

        {/* 诊断日志 */}
        <DiagnosticsCard />

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

