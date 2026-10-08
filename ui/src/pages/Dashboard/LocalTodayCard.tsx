import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { formatCost, formatMoney, formatTokensCn, progressBarClass } from "@/lib/format";
import { compareLocalWindows, summarizeLocalDay, summarizeLocalRecords } from "@/lib/local-sources";

export function LocalTodayCard({
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
