/**
 * 高危操作（启用 / 关闭采集、启动 Codex 并采集）的返回值，与主进程 electron/lib/high-risk-confirm.ts 的
 * HighRiskResult 一致。主进程先弹系统确认框：
 * - ok：用户点了「继续」，操作已执行，value 是原来的返回值；
 * - cancelled：用户取消，什么都没做；
 * - confirm-pending：已有一个确认框开着，本次请求被直接拒绝（不排队）。
 */
export type HighRiskResult<T> =
  | { status: "ok"; value: T }
  | { status: "cancelled" }
  | { status: "confirm-pending" };

/** 未执行时给用户看的提示；取消不算错误，返回空串（不显示任何提示） */
export function highRiskNotExecutedMessage(result: HighRiskResult<unknown>): string {
  return result.status === "confirm-pending" ? "已有一个待确认的操作，请先在弹出的系统确认框中处理。" : "";
}
