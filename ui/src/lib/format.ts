/** 金额格式化：根据币种加符号，保留两位小数 */
export function formatMoney(n: number | undefined, currency = "USD"): string {
  if (n == null || Number.isNaN(n)) return "—";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${symbol}${n.toFixed(2)}`;
}

/** 用量费用：四位小数，没有数字时显示破折号而不是 $0 */
export function formatCost(n: number | null | undefined, currency?: string | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${symbol}${n.toFixed(4)}`;
}

/** 本地时区 YYYY-MM-DD，与主进程 toDateKey 同一套「今天」 */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** 距下一个本地零点的毫秒数，供「今日本地 agent」跨天翻页 */
export function msUntilNextLocalMidnight(from: Date | number = new Date()): number {
  const d = from instanceof Date ? from : new Date(from);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return Math.max(0, next.getTime() - d.getTime());
}

/** 余额数值格式化：金额用货币符号，tokens/Credits 等计量单位用简写加单位 */
export function formatBalance(n: number | undefined, currency: string): string {
  if (n == null || Number.isNaN(n)) return "-";
  if (currency === "tokens") return `${formatTokens(n)} tokens`;
  if (currency === "%") return `${n.toFixed(1)}%`;
  if (currency === "USD" || currency === "CNY") return formatMoney(n, currency);
  // 其余为计量单位（如 Credits）：大数简写并带单位，避免显示成无单位裸数字
  return `${formatTokens(n)} ${currency}`;
}

/**
 * 进度条已用占比（0-100）。
 * total 缺失或非正数时返回 0，避免除零产生 NaN 宽度。
 * 注意：须传 total 一起算，不可直接把 used 当百分比——只有 total 恰为 100
 * 的服务（如火山方舟按 Percent 计）才碰巧成立。
 *
 * 任一入参非有限数（NaN / Infinity）时返回 0：
 * Math.min/Math.max 会原样透传 NaN，直接插进 CSS width 是非法样式；
 * 且脏数据宁可渲染成空条，也不能渲染成满条谎称「已用尽」。
 */
export function usedPercent(used: number | undefined, total: number | undefined): number {
  if (used == null || total == null) return 0;
  if (!Number.isFinite(used)) return 0;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** 进度条颜色：快用尽时换成警告/危险色，避免满条还是陶杏色。 */
export function progressBarClass(pct: number): string {
  if (!Number.isFinite(pct) || pct < 70) {
    return "h-full rounded-full bg-gradient-to-r from-primary to-[#d5905f]";
  }
  if (pct < 90) return "h-full rounded-full bg-amber-600";
  return "h-full rounded-full bg-destructive";
}

/** 总览页内预算横幅。不是系统通知。 */
export function budgetBannerKind(
  spent: number | null | undefined,
  budget: number | null | undefined,
): "near" | "over" | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null;
  if (spent == null || !Number.isFinite(spent) || spent < 0) return null;
  const pct = (spent / budget) * 100;
  if (pct >= 100) return "over";
  if (pct >= 80) return "near";
  return null;
}

/**
 * 卡片副行说明文案：解释主位那个数字（或那句话）是什么。
 *
 * 分支必须与主位显示保持一致，否则会出现「显示了余额数字、副行却说查不到余额」
 * 这类自相矛盾。注意多数适配器只返回 remaining 而不返回 used
 * （deepseek / 硅基流动 / 火山 / 百炼 / Kimi），不可用 used 是否存在来判断
 * 该服务有没有余额接口。
 */
export function balanceCaption(b: { remaining?: number; used?: number; currency: string }): string {
  // NaN 不算有效数字，否则会谎称「可用余额」而主位却显示占位符
  const hasRemaining = b.remaining != null && Number.isFinite(b.remaining);
  const hasUsed = b.used != null && Number.isFinite(b.used);
  if (hasRemaining && hasUsed) return `已用 ${formatBalance(b.used, b.currency)}`;
  if (hasUsed) return "本月用量";
  if (hasRemaining) return "可用余额";
  return "该服务无余额查询 API";
}

/**
 * 界面默认的 token 总量（CCSwitch 口径）：
 * 未缓存输入 + 输出 + 缓存写入 + 缓存读取 + 推理。
 * 输入在采集时已拆出 cache，这里再加 cacheRead 不会重复计。
 */
export function visibleTokens(r: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  reasoningTokens?: number;
}): number {
  return (
    r.inputTokens +
    r.outputTokens +
    (r.cacheCreationTokens ?? 0) +
    (r.cacheReadTokens ?? 0) +
    (r.reasoningTokens ?? 0)
  );
}

/** 日期键 YYYY-MM-DD -> MM-DD 展示（图表轴与分组标题共用） */
export function formatDateKey(date: string): string {
  return date.length >= 10 ? date.slice(5) : date;
}

/**
 * 紧凑数字（图表坐标轴用）：1.23M / 12.3K / 123。
 *
 * 用量页与趋势页原本各写了一份完全相同的实现。与 formatTokens 的差别只在
 * 占位符（图表轴用连字符，金额用破折号）——那是既有的展示约定，不在这里动。
 *
 * 用 Math.abs 判断量级，负数才会得到 -1.23M 而不是掉进 String(n)。
 * 另外补了 NaN 判断：此前 Math.abs(NaN) 一路比较不成立，最终
 * String(NaN) 把「NaN」直接画到坐标轴上。
 */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** token 数量简写：1.2K / 3.4M / 5.6B */
export function formatTokens(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** token 数量中文简写：1.2万 / 3.4亿（满 1 亿转亿，均留 1 位小数） */
export function formatTokensCn(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (abs >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

/** 时间格式化（中文，月日时分） */
export function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 相对时间。超过一周退回 formatTime。nowMs 可注入，方便单测。 */
export function formatRelative(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return formatTime(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return formatTime(iso);
}

/** YYYY-MM-DD 加减天数，本地时区。非法键原样返回。 */
export function addDateKey(dateKey: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(5, 7));
  const d = Number(dateKey.slice(8, 10));
  return localDateKey(new Date(y, m - 1, d + deltaDays));
}
