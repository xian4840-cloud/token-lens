import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, ChevronDown, Star, EyeOff } from "lucide-react";
import { useAppStore } from "@/store/app";
import {
  balanceCaption,
  formatBalance,
  usedPercent,
  progressBarClass,
  formatRelative,
} from "@/lib/format";
import { copyText } from "@/lib/copy-text";
import type { BalanceResult, ServiceDefinition, ServiceRecord } from "@/types";

function copyPlain(text: string) {
  copyText(text);
}

/** 总览里单个服务的余额卡片（含多项余量的展开浮层）；状态都在页面里 */
export function ServiceBalanceCard({
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
