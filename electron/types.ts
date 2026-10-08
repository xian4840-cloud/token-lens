/**
 * 服务与适配器的类型（主进程）。
 * 与界面共用的数据结构定义在 shared/types，这里转出以保持原有导入路径；
 * 只有主进程用到的（适配器接口）定义在本文件。
 */

import type { BalanceResult, ServiceDefinition, UsageResult } from "../shared/types";

export type {
  AppBootstrap,
  BalanceResult,
  BalanceSnapshot,
  BreakdownItem,
  ConfigField,
  ConfigFieldType,
  LocalDailyUsageRecord,
  ProxyMode,
  ProxyTestResult,
  ProxyTestTargetResult,
  ServiceDefinition,
  ServiceInput,
  ServiceKind,
  ServiceRecord,
  UsageItem,
  UsageRecord,
  UsageResult,
} from "../shared/types";

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
