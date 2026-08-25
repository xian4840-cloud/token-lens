import type {
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  LocalUsageRow,
  ModelPricing,
  PricingRowDisplay,
  ScanLocalUsageResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  UsageResult,
  ProxyMode,
  ProxyTestResult,
  ProxyTestTargetResult,
} from "@/types";


/** 前端调用主进程的统一封装 */
export const ipc = {
  ping: () => window.tokenLens.ping(),
  isEncryptionAvailable: () => window.tokenLens.isEncryptionAvailable(),

  listDefinitions: () => window.tokenLens.listDefinitions(),
  listServices: () => window.tokenLens.listServices(),
  createService: (input: ServiceInput) =>
    window.tokenLens.createService(input),
  updateService: (id: string, input: ServiceInput) =>
    window.tokenLens.updateService(id, input),
  deleteService: (id: string) => window.tokenLens.deleteService(id),
  refreshService: (id: string) => window.tokenLens.refreshService(id),
  listSnapshots: (serviceId?: string, since?: string) =>
    window.tokenLens.listSnapshots(serviceId, since),
  refreshUsage: (id: string, period: { start: string; end: string }) =>
    window.tokenLens.refreshUsage(id, period),
  listUsage: (serviceId?: string, since?: string) =>
    window.tokenLens.listUsage(serviceId, since),
  onBalanceUpdated: (
    cb: (payload: {
      id: string;
      balance?: BalanceResult;
      error?: string;
    }) => void,
  ) => window.tokenLens.onBalanceUpdated(cb),

  getSetting: (key: string) => window.tokenLens.getSetting(key),
  setSetting: (key: string, value: string) =>
    window.tokenLens.setSetting(key, value),
  getPricingTable: () => window.tokenLens.getPricingTable(),
  savePricingOverrides: (value: Record<string, Partial<ModelPricing>>) =>
    window.tokenLens.savePricingOverrides(value),
  scanLocalUsage: (since?: string) => window.tokenLens.scanLocalUsage(since),
  listLocalDaily: (since?: string, until?: string) =>
    window.tokenLens.listLocalDaily(since, until),
  loginVolcengine: () => window.tokenLens.loginVolcengine(),
  loginScnet: () => window.tokenLens.loginScnet(),
  testProxy: (override?: {
    mode?: string;
    customUrl?: string;
    bypassRules?: string;
  }) => window.tokenLens.testProxy(override),
};

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
};

