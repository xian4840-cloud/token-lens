import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Server, Plus } from "lucide-react";
import { useAppStore } from "@/store/app";
import { formatMoney, budgetBannerKind, formatRelative } from "@/lib/format";
import { compareLocalWindows, summarizeLocalDay, summarizeLocalRecords } from "@/lib/local-sources";
import { useLocalDateKey } from "@/lib/use-local-date-key";
import { isTypingTarget } from "@/lib/shortcuts";
import { sortPinnedFirst } from "@/lib/id-list";
import { applySearchEscape } from "@/lib/search-escape";
import { LocalTodayCard } from "./LocalTodayCard";
import { ServiceBalanceCard } from "./ServiceBalanceCard";

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
