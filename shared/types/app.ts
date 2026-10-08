/** 应用级数据：启动数据、日志、代理、备份等 */

import type { LocalDailyUsageRecord } from "./local-usage";
import type { BalanceResult, ServiceDefinition, ServiceRecord } from "./service";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  time: string;
  level: LogLevel;
  /** 出错的模块，如 "refresh" / "adapter:gemini" / "local-usage" */
  scope: string;
  message: string;
}

export type ProxyMode = "system" | "custom" | "direct";

/** 代理测试时临时覆盖的设置（未保存的表单值） */
export interface ProxyConfigOverride {
  mode?: string;
  customUrl?: string;
  bypassRules?: string;
}

export interface ProxyTestTargetResult {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  statusText?: string;
  error?: string;
}

export interface ProxyTestResult {
  targets: ProxyTestTargetResult[];
}

/** 启动一次带回的数据，避免前端连打 8 次 IPC 再空等网络刷新 */
export interface AppBootstrap {
  definitions: ServiceDefinition[];
  services: ServiceRecord[];
  settings: {
    refreshInterval: string;
    proxyMode: string;
    proxyCustomUrl: string;
    proxyBypassRules: string;
    requestTimeout: string;
    monthlyBudgetUsd: string;
    pinnedServiceIds: string;
    hiddenServiceIds: string;
  };
  lastBalances: Record<string, BalanceResult>;
  petEnabled: boolean;
  todayLocal: LocalDailyUsageRecord[];
  monthLocal: LocalDailyUsageRecord[];
}

/** 余额刷新结果推送（定时刷新完成或出错） */
export interface BalanceUpdatedPayload {
  id: string;
  balance?: BalanceResult;
  error?: string;
}

/** 导入前预览备份 */
export interface BackupPreview {
  local: number;
  usage: number;
  /** 备份里的服务数 */
  services: number;
  exportedAt: string;
}

export interface BackupImportResult {
  /** 写入（或覆盖）的本地日桶数 */
  local: number;
  /** 新写入的 API 用量记录数 */
  usage: number;
  /** 因重复或找不到对应服务而跳过的用量记录数 */
  usageSkipped: number;
  /** 新建、需重新填写密钥的服务数 */
  services: number;
  /** 对上本机已有服务的数 */
  servicesMatched: number;
  /** 类型不支持或条目残缺、未恢复的服务数 */
  servicesSkipped: number;
}

/** 设置页「数据」卡片的统计 */
export interface DataStats {
  services: number;
  usageRecords: number;
  localDaily: number;
  snapshots: number;
  bytes: number;
}

export interface ImportLocalRowsResult {
  imported: number;
  skipped: number;
}

export interface ClearLocalUsageCacheResult {
  success: boolean;
  error?: string;
}

export interface VolcengineLoginResult {
  cookie: string;
  xWebId: string;
}

export interface ScnetLoginResult {
  cookie: string;
}
