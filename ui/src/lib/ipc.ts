import type { TokenLensApi, TokenLensPetApi } from "@shared/ipc";

type Api = TokenLensApi & TokenLensPetApi;

/**
 * 前端调用主进程的统一入口：ipc.xxx(...) 原样转给 window.tokenLens.xxx(...)。
 *
 * 方法与类型全部来自 shared/ipc.ts，新增通道时这里不用改。
 * 用 Proxy 而不是直接导出 window.tokenLens：调用时才去取 window.tokenLens，
 * 与此前逐个包装的写法行为一致（模块加载早于 preload 注入、测试里替换 window.tokenLens 都不受影响）。
 */
export const ipc: Api = new Proxy({} as Api, {
  get(_target, key: string | symbol) {
    if (typeof key !== "string") return undefined;
    return (...args: unknown[]) =>
      (window.tokenLens as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
  },
});

export type {
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  LocalUsageRow,
  ProxyMode,
  ProxyTestResult,
  ProxyTestTargetResult,
  ScanLocalUsageResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
} from "@shared/types";
