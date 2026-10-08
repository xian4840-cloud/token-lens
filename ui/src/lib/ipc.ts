import type {
  AppBootstrap,
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
  PetActivity,
  PetSpendSummary,
} from "@/types";


/** 前端调用主进程的统一封装 */
export const ipc = {
  getModelMonitorState: (date?: string, source?: import("@/types").ModelMonitorSource) => window.tokenLens.getModelMonitorState(date, source),
  launchCapturedCodex: () => window.tokenLens.launchCapturedCodex(),
  enableOpenCodeCapture: () => window.tokenLens.enableOpenCodeCapture(),
  enableClaudeCapture: () => window.tokenLens.enableClaudeCapture(),
  disableOpenCodeCapture: () => window.tokenLens.disableOpenCodeCapture(),
  disableClaudeCapture: () => window.tokenLens.disableClaudeCapture(),
  ping: () => window.tokenLens.ping(),
  isEncryptionAvailable: () => window.tokenLens.isEncryptionAvailable(),
  bootstrap: () => window.tokenLens.bootstrap(),
  revealUserData: () => window.tokenLens.revealUserData(),
  backupJson: () => window.tokenLens.backupJson(),
  previewBackup: (raw: string) => window.tokenLens.previewBackup(raw),
  importBackup: (raw: string) => window.tokenLens.importBackup(raw),
  dataStats: () => window.tokenLens.dataStats(),
  getRecentLogs: () => window.tokenLens.getRecentLogs(),
  getLogPath: () => window.tokenLens.getLogPath(),
  importLocalRows: (rows: unknown[]) => window.tokenLens.importLocalRows(rows),
  saveText: (defaultName: string, content: string) =>
    window.tokenLens.saveText(defaultName, content),

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
  onLocalUsageUpdated: (cb: () => void) =>
    window.tokenLens.onLocalUsageUpdated(cb),
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
  clearLocalUsageCache: () => window.tokenLens.clearLocalUsageCache(),
  loginVolcengine: () => window.tokenLens.loginVolcengine(),
  loginScnet: () => window.tokenLens.loginScnet(),
  testProxy: (override?: {
    mode?: string;
    customUrl?: string;
    bypassRules?: string;
  }) => window.tokenLens.testProxy(override),

  getPetEnabled: () => window.tokenLens.getPetEnabled(),
  setPetEnabled: (enabled: boolean) => window.tokenLens.setPetEnabled(enabled),
  petTodaySpend: () => window.tokenLens.petTodaySpend(),
  getPetActivity: () => window.tokenLens.getPetActivity(),
  petDragStart: () => window.tokenLens.petDragStart(),
  petDragMove: () => window.tokenLens.petDragMove(),
  petDragEnd: () => window.tokenLens.petDragEnd(),
  onPetActivity: (cb: (activity: PetActivity) => void) =>
    window.tokenLens.onPetActivity(cb),
  onPetSpendUpdated: (cb: (summary: PetSpendSummary) => void) =>
    window.tokenLens.onPetSpendUpdated(cb),
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

