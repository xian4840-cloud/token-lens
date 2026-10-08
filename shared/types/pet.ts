/** 桌宠窗口 */

import type { LocalSource } from "./local-usage";

/** 宠物根据本地会话文件写入推断出的活动状态 */
export type PetActivityStatus = "idle" | "working";

export interface PetActivity {
  status: PetActivityStatus;
  source?: LocalSource;
}

export interface PetSourceSpend {
  source: LocalSource;
  label: string;
  cost: number | null;
  tokens: number;
  unpriced: boolean;
}

/** 某日本地 agent 花费汇总，供宠物点击气泡展示 */
export interface PetSpendSummary {
  date: string;
  /** 能换算出金额的合计；全部未知时为 null，不要当成 0 */
  cost: number | null;
  currency: string;
  tokens: number;
  bySource: PetSourceSpend[];
  hasUnpriced: boolean;
}
