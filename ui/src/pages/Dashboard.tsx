import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Server, Plus, ChevronDown } from "lucide-react";
import { useAppStore } from "@/store/app";
import { balanceCaption, formatBalance, formatTime, usedPercent } from "@/lib/format";

export function Dashboard() {
  const services = useAppStore((s) => s.services);
  const balances = useAppStore((s) => s.balances);
  const errors = useAppStore((s) => s.errors);
  const refreshing = useAppStore((s) => s.refreshing);
  const loaded = useAppStore((s) => s.loaded);
  const init = useAppStore((s) => s.init);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!loaded) init();
  }, [loaded, init]);

  return (
    <div>
      <PageHeader title="总览" description="各服务余额与余量一览">
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={refreshing || services.length === 0}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          全部刷新
        </Button>
      </PageHeader>
      <div className="px-8 pb-8 pt-4">
        {services.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-white/30 py-16 text-center">
            <Server className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">还未添加任何服务</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/services">
                <Plus />
                添加服务
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((s) => {
              const bal = balances[s.id];
              const err = errors[s.id];
              return (
                <div key={s.id} className="relative">
                <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_40px_rgba(90,75,50,0.14)]">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-display text-lg font-medium">{s.name}</CardTitle>
                      <Badge variant="secondary">{s.provider}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {err ? (
                      <p className="line-clamp-2 text-sm text-destructive" title={err}>
                        {err}
                      </p>
                    ) : bal ? (
                      <div>
                        {bal.breakdown && bal.breakdown.length > 0 ? (
                          <div className="space-y-2">
                            {bal.breakdown[0] && (
                              <div>
                                <div className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">{bal.breakdown[0].label}</span>
                                  <span className="tabular">
                                    剩余 {formatBalance(bal.breakdown[0].remaining, bal.breakdown[0].unit ?? bal.currency)}
                                  </span>
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/60">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary to-[#d5905f]"
                                    style={{ width: `${usedPercent(bal.breakdown[0].used, bal.breakdown[0].total)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            {bal.breakdown.length > 1 && (
                              <button
                                type="button"
                                onClick={() => toggle(s.id)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <ChevronDown className={expanded.has(s.id) ? "size-3 rotate-180" : "size-3"} />
                                {expanded.has(s.id) ? "收起" : "展开周/月"}
                              </button>
                            )}
                            <div className="text-xs text-muted-foreground">
                              {formatTime(bal.fetchedAt)}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className={
                                bal.remaining != null || bal.used != null
                                  ? "font-display text-3xl tracking-tight"
                                  : // 纯文案时缩小字号，避免长文字撑破卡片
                                    "font-display text-xl tracking-tight text-muted-foreground"
                              }
                            >
                              {bal.remaining != null
                                ? formatBalance(bal.remaining, bal.currency)
                                : bal.used != null
                                  ? formatBalance(bal.used, bal.currency)
                                  : // 查不到数字时由适配器给出原因，不臆断服务免费
                                    (bal.statusLabel ?? "无余额数据")}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {balanceCaption(bal)}
                              {" · "}
                              {formatTime(bal.fetchedAt)}
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">点击刷新查看</div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 px-0 text-xs"
                      onClick={() => useAppStore.getState().refreshService(s.id)}
                    >
                      <RefreshCw className="size-3" />
                      刷新
                    </Button>
                  </CardContent>
                </Card>
                {expanded.has(s.id) && bal?.breakdown && bal.breakdown.length > 1 && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-white/50 bg-popover p-3 text-popover-foreground shadow-lg backdrop-blur-xl">
                    <div className="space-y-2">
                      {bal.breakdown.slice(1).map((b) => (
                        <div key={b.label}>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{b.label}</span>
                            <span className="tabular">
                              剩余 {formatBalance(b.remaining, b.unit ?? bal.currency)}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/60">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary to-[#d5905f]"
                              style={{ width: `${usedPercent(b.used, b.total)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
