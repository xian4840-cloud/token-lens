/** 金额格式化：根据币种加符号，保留两位小数 */
export function formatMoney(n: number | undefined, currency = "USD"): string {
  if (n == null || Number.isNaN(n)) return "—";
  const symbol = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${symbol}${n.toFixed(2)}`;
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
export function usedPercent(
  used: number | undefined,
  total: number | undefined,
): number {
  if (used == null || total == null) return 0;
  if (!Number.isFinite(used)) return 0;
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * 卡片副行说明文案：解释主位那个数字（或那句话）是什么。
 *
 * 分支必须与主位显示保持一致，否则会出现「显示了余额数字、副行却说查不到余额」
 * 这类自相矛盾。注意多数适配器只返回 remaining 而不返回 used
 * （deepseek / 硅基流动 / 火山 / 百炼 / Kimi），不可用 used 是否存在来判断
 * 该服务有没有余额接口。
 */
export function balanceCaption(b: {
  remaining?: number;
  used?: number;
  currency: string;
}): string {
  // NaN 不算有效数字，否则会谎称「可用余额」而主位却显示占位符
  const hasRemaining = b.remaining != null && Number.isFinite(b.remaining);
  const hasUsed = b.used != null && Number.isFinite(b.used);
  if (hasRemaining && hasUsed) return `已用 ${formatBalance(b.used, b.currency)}`;
  if (hasUsed) return "本月用量";
  if (hasRemaining) return "可用余额";
  return "该服务无余额查询 API";
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
