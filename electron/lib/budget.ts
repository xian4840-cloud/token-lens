/** 月度预算上限，挡住把进度条撑爆的输入。 */
export const MAX_MONTHLY_BUDGET_USD = 1_000_000;

/**
 * 解析月度预算（USD）。空串 / 非法 / ≤0 视为关闭。
 * 超过上限时夹到上限，不抛——设置框里手滑多打一个 0 不该让保存失败。
 */
export function parseMonthlyBudgetUsd(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, MAX_MONTHLY_BUDGET_USD);
}
