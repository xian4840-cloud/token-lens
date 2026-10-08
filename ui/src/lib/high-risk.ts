import type { HighRiskResult } from "@shared/types";

/** 高危操作的返回值（定义在 shared/types/model-monitor.ts，与主进程共用） */
export type { HighRiskResult };

/** 未执行时给用户看的提示；取消不算错误，返回空串（不显示任何提示） */
export function highRiskNotExecutedMessage(result: HighRiskResult<unknown>): string {
  return result.status === "confirm-pending"
    ? "已有一个待确认的操作，请先在弹出的系统确认框中处理。"
    : "";
}
