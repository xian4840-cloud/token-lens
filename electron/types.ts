/** 服务与适配器的共享类型定义（主进程） */

import type { LocalSource } from "./local-usage/types";

export type ServiceKind = "api" | "plan";

export type ConfigFieldType = "string" | "password" | "select" | "number";

export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  placeholder?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  help?: string;
  /** 是否为敏感字段（password 自动视为敏感，加密存储） */
  secret?: boolean;
}

/** 服务的静态定义（由适配器声明） */
export interface ServiceDefinition {
  provider: string;
  label: string;
  kind: ServiceKind;
  configSchema: ConfigField[];
  official: boolean;
  description?: string;
  /** 是否支持用量明细查询（实现了 fetchUsage） */
  supportsUsage?: boolean;
}

/** 数据库中的服务记录（不含密钥） */
export interface ServiceRecord {
  id: string;
  name: string;
  provider: string;
  kind: ServiceKind;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BreakdownItem {
  label: string;
  used?: number;
  total?: number;
  remaining?: number;
  unit?: string;
  resetAt?: string;
}

export interface BalanceSnapshot {
  id: number;
  serviceId: string;
  balance: number | null;
  currency: string;
  recordedAt: string;
}

export interface BalanceResult {
  total?: number;
  used?: number;
  remaining?: number;
  currency: string;
  expiresAt?: string;
  fetchedAt: string;
  raw?: unknown;
  breakdown?: BreakdownItem[];
  /**
   * 无数字可展示时（total / used / remaining 全缺）卡片主位显示的文案。
   * 供仅能校验 Key 有效性的适配器说明「查不到数字」的原因，
   * 不要在此断言服务是否免费——多数服务同时有免费与付费档。
   */
  statusLabel?: string;
}

export interface UsageItem {
  model: string;
  normalizedModel?: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface UsageResult {
  items: UsageItem[];
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  fetchedAt: string;
}

/** 持久化的用量记录（每条对应某服务某周期某模型） */
export interface UsageRecord {
  id: number;
  serviceId: string;
  model: string | null;
  normalizedModel: string | null;
  cost: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  period: string | null;
  currency: string | null;
  recordedAt: string;
}

/** 持久化的本地 agent 每日用量（每条对应某 source+model+date） */
export interface LocalDailyUsageRecord {
  id: number;
  source: LocalSource;
  model: string;
  /** 日期键 YYYY-MM-DD（本地时区） */
  date: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  cost: number | null;
  currency: string | null;
  /** 当日该桶最早 / 最晚记录时间（ISO） */
  firstAt: string | null;
  lastAt: string | null;
  /** 该日数据最后被扫描确认的时间 */
  scannedAt: string;
}

/** 适配器统一接口：每家服务实现一份 */
export interface Adapter {
  definition: ServiceDefinition;
  fetchBalance(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
  ): Promise<BalanceResult>;
  fetchUsage?(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    period: { start: string; end: string },
  ): Promise<UsageResult>;
}

/** 前端提交的建表/更新负载 */
export interface ServiceInput {
  name: string;
  provider: string;
  fields: Record<string, string>;
}

export type ProxyMode = "system" | "custom" | "direct";

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

