/** 服务、余额、用量明细：主进程与界面共用的数据结构 */

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
  /**
   * 从备份恢复、尚未重新填写密钥。备份按设计不含密钥与 config，
   * 恢复出来的服务只有名称与类型，必须到管理页编辑补全后才能刷新。
   */
  needsCredentials?: boolean;
}

/** 前端提交的建表/更新负载 */
export interface ServiceInput {
  name: string;
  provider: string;
  fields: Record<string, string>;
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

export interface ModelPricing {
  /** 输入 token 单价（/ 1M tokens） */
  inputPerM: number;
  /** 输出 token 单价（/ 1M tokens） */
  outputPerM: number;
  /** 缓存读取（命中）单价（/ 1M tokens） */
  cacheReadPerM?: number;
  /** 缓存写入（创建）单价（/ 1M tokens） */
  cacheWritePerM?: number;
  /** 货币，默认 USD */
  currency?: string;
}

/** 设置页展示用的价格行（无正则，可序列化） */
export interface PricingRowDisplay {
  key: string;
  label: string;
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
  currency: string;
  /** 该行是否有用户覆盖（用于显示「恢复默认」） */
  overridden?: boolean;
  defaults?: {
    inputPerM: number;
    outputPerM: number;
    cacheReadPerM: number;
    cacheWritePerM: number;
  };
}
