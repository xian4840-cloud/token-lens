import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RefreshCw, Server, Plus, ChevronDown, Bot, Star, EyeOff } from "lucide-react";
import { useAppStore } from "@/store/app";
import {
  balanceCaption,
  formatBalance,
  formatCost,
  formatMoney,
  formatTokensCn,
  usedPercent,
  progressBarClass,
  budgetBannerKind,
  formatRelative,
} from "@/lib/format";
import { compareLocalWindows, summarizeLocalDay, summarizeLocalRecords } from "@/lib/local-sources";
import { copyText } from "@/lib/copy-text";
import { useLocalDateKey } from "@/lib/use-local-date-key";
import { isTypingTarget } from "@/lib/shortcuts";
import { sortPinnedFirst } from "@/lib/id-list";
import { applySearchEscape } from "@/lib/search-escape";
import type { BalanceResult, ServiceDefinition, ServiceRecord } from "@/types";

function copyPlain(text: string) {
  copyText(text);
}

export function Dashboard() {
  const services = useAppStore((s) => s.services);
  const definitions = useAppStore((s) => s.definitions);
  const balances = useAppStore((s) => s.balances);
  const errors = useAppStore((s) => s.errors);
  const refreshing = useAppStore((s) => s.refreshing);
  const refreshingIds = useAppStore((s) => s.refreshingIds);
  const loaded = useAppStore((s) => s.loaded);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const todayLocal = useAppStore((s) => s.todayLocal);
  const monthLocal = useAppStore((s) => s.monthLocal);
  const monthlyBudgetUsd = useAppStore((s) => s.monthlyBudgetUsd);
  const pinnedIds = useAppStore((s) => s.pinnedIds);
  const hiddenIds = useAppStore((s) => s.hiddenIds);
  const togglePinned = useAppStore((s) => s.togglePinned);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const refreshService = useAppStore((s) => s.refreshService);
  const loadTodayLocal = useAppStore((s) => s.loadTodayLocal);
  const todayKey = useLocalDateKey();

  useEffect(() => {
    void loadTodayLocal();
  }, [todayKey, loadTodayLocal]);

  const todaySummary = useMemo(
    () => summarizeLocalDay(todayLocal, todayKey),
    [todayLocal, todayKey],
  );
  const monthSummary = useMemo(() => {
    const monthStart = `${todayKey.slice(0, 7)}-01`;
    return summarizeLocalRecords(
      monthLocal.filter((r) => r.date >= monthStart),
      todayKey.slice(0, 7),
    );
  }, [monthLocal, todayKey]);
  const weekCompare = useMemo(
    () => compareLocalWindows(monthLocal, todayKey, 7),
    [monthLocal, todayKey],
  );
  const budgetNum = Number(monthlyBudgetUsd);
  const budget = Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [serviceQuery, setServiceQuery] = useState("");
  const visibleServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    const unhidden = services.filter((s) => !hiddenIds.includes(s.id));
    const filtered = !q
      ? unhidden
      : unhidden.filter((s) => {
          const label = definitions.find((d) => d.provider === s.provider)?.label ?? s.provider;
          return (
            s.name.toLowerCase().includes(q) ||
            s.provider.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q)
          );
        });
    return sortPinnedFirst(filtered, pinnedIds);
  }, [services, definitions, serviceQuery, pinnedIds, hiddenIds]);
  const lastFetchedAt = useMemo(() => {
    let max = "";
    for (const b of Object.values(balances)) {
      if (b?.fetchedAt && b.fetchedAt > max) max = b.fetchedAt;
    }
    return max || undefined;
  }, [balances]);
  const banner = budgetBannerKind(monthSummary.cost, budget);
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (expanded.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setExpanded(new Set());
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("[data-breakdown-root]")) return;
      setExpanded(new Set());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [expanded.size]);

  return (
    <div>
      <PageHeader
        title="总览"
        description={
          lastFetchedAt
            ? `各服务余额与余量一览 · ${formatRelative(lastFetchedAt)}`
            : "各服务余额与余量一览"
        }
      >
        <div className="flex gap-2">
          {services.some((s) => errors[s.id]) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const s of services) {
                  if (errors[s.id]) void refreshService(s.id);
                }
              }}
            >
              重试失败
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={refreshing || services.length === 0}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            全部刷新
          </Button>
        </div>
      </PageHeader>
      <div className="space-y-4 px-8 pb-8 pt-4">
        {!loaded ? (
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : (
          <>
            {banner === "over" ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                本月本地 agent 花费已超过预算
                {monthSummary.cost != null && budget != null
                  ? `（${formatMoney(monthSummary.cost, monthSummary.currency)} / ${formatMoney(budget, "USD")}）`
                  : ""}
              </div>
            ) : banner === "near" ? (
              <div className="rounded-lg border border-amber-700/30 bg-amber-700/10 px-4 py-2.5 text-sm text-amber-900">
                本月本地 agent 花费已接近预算
                {monthSummary.cost != null && budget != null
                  ? `（${formatMoney(monthSummary.cost, monthSummary.currency)} / ${formatMoney(budget, "USD")}）`
                  : ""}
              </div>
            ) : null}
            <LocalTodayCard
              summary={todaySummary}
              monthSummary={monthSummary}
              weekCompare={weekCompare}
              budget={budget}
            />
            {services.length === 0 ? (
              <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-white/30 py-12 text-center">
                <Server className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">还未添加任何 API 服务</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  本机 Claude Code / Codex / OpenCode / Antigravity / Grok Build
                  的会话会自动采集，不必先填 Key。
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/services">
                    <Plus />
                    添加服务
                  </Link>
                </Button>
              </Card>
            ) : (
              <>
                {hiddenIds.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    已从总览隐藏 {hiddenIds.length} 个服务，
                    <Link to="/services" className="underline hover:text-foreground">
                      去管理页恢复
                    </Link>
                  </p>
                ) : null}
                {services.length > 3 || serviceQuery ? (
                  <Input
                    value={serviceQuery}
                    onChange={(e) => setServiceQuery(e.target.value)}
                    placeholder="搜索服务"
                    aria-label="搜索服务"
                    className="max-w-sm"
                    onKeyDown={(e) => applySearchEscape(e, serviceQuery, () => setServiceQuery(""))}
                  />
                ) : null}
                {visibleServices.length === 0 ? (
                  <Card className="py-10 text-center text-sm text-muted-foreground">
                    {serviceQuery.trim()
                      ? `没有匹配「${serviceQuery.trim()}」的服务`
                      : "服务已从总览隐藏，可在管理页恢复显示"}
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleServices.map((s) => {
                      const bal = balances[s.id];
                      const err = errors[s.id];
                      const busy = !!refreshingIds[s.id];
                      return (
                        <ServiceBalanceCard
                          key={s.id}
                          s={s}
                          bal={bal}
                          err={err}
                          busy={busy}
                          definitions={definitions}
                          pinnedIds={pinnedIds}
                          expanded={expanded}
                          toggle={toggle}
                          togglePinned={togglePinned}
                          toggleHidden={toggleHidden}
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 总览里单个服务的余额卡片（含多项余量的展开浮层）；状态都在页面里 */
function ServiceBalanceCard({
  s,
  bal,
  err,
  busy,
  definitions,
  pinnedIds,
  expanded,
  toggle,
  togglePinned,
  toggleHidden,
}: {
  s: ServiceRecord;
  bal: BalanceResult | undefined;
  err: string | undefined;
  busy: boolean;
  definitions: ServiceDefinition[];
  pinnedIds: string[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  togglePinned: (id: string) => Promise<void>;
  toggleHidden: (id: string) => Promise<void>;
}) {
  return (
    <div className="relative" data-breakdown-root>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_40px_rgba(90,75,50,0.14)]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="font-display text-lg font-medium">{s.name}</CardTitle>
            {/*
    徽章显示服务定义的中文名（如「超算互联网 Token Plan」）而非
    provider ID。name 是用户自填且可与实际服务无关（切换服务类型时
    不会自动更新），徽章是唯一能看出这张卡查的是哪一家的地方，
    必须写成人能直接认出的名字。
    */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={pinnedIds.includes(s.id) ? "取消置顶" : "置顶"}
                aria-label={pinnedIds.includes(s.id) ? "取消置顶" : "置顶"}
                aria-pressed={pinnedIds.includes(s.id)}
                onClick={() => void togglePinned(s.id)}
                className="rounded-md p-1 text-muted-foreground hover:text-primary"
              >
                <Star
                  className={
                    pinnedIds.includes(s.id) ? "size-3.5 fill-primary text-primary" : "size-3.5"
                  }
                />
              </button>
              <button
                type="button"
                title="从总览隐藏"
                aria-label="从总览隐藏"
                onClick={() => void toggleHidden(s.id)}
                className="rounded-md p-1 text-muted-foreground hover:text-primary"
              >
                <EyeOff className="size-3.5" />
              </button>
              <Badge variant="secondary">
                {definitions.find((d) => d.provider === s.provider)?.label ?? s.provider}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!bal && busy ? (
            <div className="space-y-2 py-1">
              <div className="h-8 w-28 animate-pulse rounded bg-muted/60" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted/40" />
            </div>
          ) : bal ? (
            <div>
              {bal.breakdown && bal.breakdown.length > 0 ? (
                <div className="space-y-2">
                  {bal.breakdown[0] && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{bal.breakdown[0].label}</span>
                        <button
                          type="button"
                          className="tabular hover:underline"
                          title="复制"
                          aria-label="复制余额"
                          onClick={() => {
                            const item = bal.breakdown?.[0];
                            if (!item) return;
                            copyPlain(formatBalance(item.remaining, item.unit ?? bal.currency));
                          }}
                        >
                          剩余{" "}
                          {formatBalance(
                            bal.breakdown[0].remaining,
                            bal.breakdown[0].unit ?? bal.currency,
                          )}
                        </button>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/60">
                        <div
                          className={progressBarClass(
                            usedPercent(bal.breakdown[0].used, bal.breakdown[0].total),
                          )}
                          style={{
                            width: `${usedPercent(bal.breakdown[0].used, bal.breakdown[0].total)}%`,
                          }}
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
                      <ChevronDown
                        className={expanded.has(s.id) ? "size-3 rotate-180" : "size-3"}
                      />
                      {expanded.has(s.id) ? "收起" : "展开明细"}
                    </button>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {busy ? "刷新中" : `上次 · ${formatRelative(bal.fetchedAt)}`}
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    title="复制"
                    aria-label="复制余额"
                    className={
                      bal.remaining != null || bal.used != null
                        ? "font-display text-3xl tracking-tight hover:underline"
                        : // 纯文案时缩小字号，避免长文字撑破卡片
                          "font-display text-xl tracking-tight text-muted-foreground hover:underline"
                    }
                    onClick={() => {
                      const text =
                        bal.remaining != null
                          ? formatBalance(bal.remaining, bal.currency)
                          : bal.used != null
                            ? formatBalance(bal.used, bal.currency)
                            : (bal.statusLabel ?? "无余额数据");
                      copyPlain(text);
                    }}
                  >
                    {bal.remaining != null
                      ? formatBalance(bal.remaining, bal.currency)
                      : bal.used != null
                        ? formatBalance(bal.used, bal.currency)
                        : // 查不到数字时由适配器给出原因，不臆断服务免费
                          (bal.statusLabel ?? "无余额数据")}
                  </button>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {balanceCaption(bal)}
                    {" · "}
                    {busy ? "刷新中" : `上次 · ${formatRelative(bal.fetchedAt)}`}
                  </div>
                </>
              )}
              {err ? (
                <button
                  type="button"
                  className="mt-2 line-clamp-2 text-left text-xs text-destructive hover:underline"
                  title="点击复制错误"
                  onClick={() => copyPlain(err)}
                >
                  {err}
                </button>
              ) : null}
            </div>
          ) : err ? (
            <button
              type="button"
              className="line-clamp-2 text-left text-sm text-destructive hover:underline"
              title="点击复制错误"
              onClick={() => copyPlain(err)}
            >
              {err}
            </button>
          ) : (
            <div className="text-sm text-muted-foreground">点击刷新查看</div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 px-0 text-xs"
            disabled={busy}
            onClick={() => useAppStore.getState().refreshService(s.id)}
          >
            <RefreshCw className={busy ? "size-3 animate-spin" : "size-3"} />
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
                  <button
                    type="button"
                    className="tabular hover:underline"
                    title="复制"
                    aria-label={`复制${b.label}余额`}
                    onClick={() => copyPlain(formatBalance(b.remaining, b.unit ?? bal.currency))}
                  >
                    剩余 {formatBalance(b.remaining, b.unit ?? bal.currency)}
                  </button>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/60">
                  <div
                    className={progressBarClass(usedPercent(b.used, b.total))}
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
}

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-5 w-24 animate-pulse rounded bg-muted/60" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-32 animate-pulse rounded bg-muted/60" />
        <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted/40" />
      </CardContent>
    </Card>
  );
}

function LocalTodayCard({
  summary,
  monthSummary,
  weekCompare,
  budget,
}: {
  summary: ReturnType<typeof summarizeLocalDay>;
  monthSummary: ReturnType<typeof summarizeLocalRecords>;
  weekCompare: ReturnType<typeof compareLocalWindows>;
  budget: number | null;
}) {
  const hasData = summary.tokens > 0;
  const monthCost = monthSummary.cost;
  const monthPct = budget != null && monthCost != null ? (monthCost / budget) * 100 : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 font-display text-lg font-medium">
            <Bot className="size-4 text-primary" />
            今日本地 agent
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="text-xs">
            <Link to="/usage">查看明细</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div>
            <div className="font-display text-3xl tracking-tight">
              {formatTokensCn(summary.tokens)}
              <span className="ml-2 text-base font-sans text-muted-foreground">
                {summary.cost != null ? formatCost(summary.cost, summary.currency) : "部分未标价"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {summary.bySource.map((s) => (
                <span key={s.source}>
                  {s.label} {formatTokensCn(s.tokens)}
                </span>
              ))}
              {summary.hasUnpriced ? <span>含未标价模型</span> : null}
            </div>
            {(weekCompare.current.tokens > 0 || weekCompare.previous.tokens > 0) && (
              <div className="mt-2 text-xs text-muted-foreground">
                近 7 天 {formatTokensCn(weekCompare.current.tokens)}
                {weekCompare.current.cost != null
                  ? ` ${formatCost(weekCompare.current.cost, weekCompare.current.currency)}`
                  : ""}
                {" · "}前 7 天 {formatTokensCn(weekCompare.previous.tokens)}
                {weekCompare.previous.cost != null
                  ? ` ${formatCost(weekCompare.previous.cost, weekCompare.previous.currency)}`
                  : ""}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            本机尚未采集到今日用量。Claude Code / Codex / OpenCode / Antigravity / Grok Build
            的会话会自动出现在这里。
          </p>
        )}
        {(monthSummary.tokens > 0 || budget != null) && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">本月累计</span>
              <span className="tabular">
                {monthCost != null
                  ? formatMoney(monthCost, monthSummary.currency)
                  : monthSummary.tokens > 0
                    ? "部分未标价"
                    : formatMoney(0, "USD")}
                {budget != null ? ` / ${formatMoney(budget, "USD")}` : null}
              </span>
            </div>
            {budget != null && (
              <>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/60">
                  <div
                    className={progressBarClass(monthPct ?? 0)}
                    style={{
                      width: `${monthPct == null ? 0 : Math.min(100, monthPct)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {monthPct == null
                    ? "尚未产生标价用量"
                    : monthPct >= 100
                      ? `已超预算 ${monthPct.toFixed(0)}%`
                      : `已用 ${monthPct.toFixed(0)}%`}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
