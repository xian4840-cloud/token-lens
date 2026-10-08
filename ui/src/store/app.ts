import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { addDateKey, localDateKey } from "@/lib/format";
import { DEFAULT_BYPASS_RULES as DEFAULT_BYPASS } from "@/lib/proxy";
import { reportError } from "@/lib/error-reporting";
import { showToast } from "@/lib/toast";
import { refreshFailureMessage, usageRefreshFailureMessage } from "@/lib/refresh-summary";
import { parseIdList, toggleId } from "@/lib/id-list";
import type {
  BalanceResult,
  BalanceSnapshot,
  LocalDailyUsageRecord,
  ModelPricing,
  PricingRowDisplay,
  ScanLocalUsageResult,
  ServiceDefinition,
  ServiceInput,
  ServiceRecord,
  UsageRecord,
  ProxyMode,
  ProxyTestResult,
} from "@/types";

/** 防止自动刷新监听重复注册（React StrictMode / 多页 init） */
let balanceListenerRegistered = false;
let localUsageListenerRegistered = false;
/** init 单飞：StrictMode 双 effect 不能打两轮厂商 API */
let initPromise: Promise<void> | null = null;
let usageSeq = 0;
let snapshotSeq = 0;
let localDailySeq = 0;

interface AppState {
  definitions: ServiceDefinition[];
  services: ServiceRecord[];
  balances: Record<string, BalanceResult | undefined>;
  errors: Record<string, string>;
  refreshing: boolean;
  /** 正在刷新的服务 id，用于单卡转圈而不是整页空白 */
  refreshingIds: Record<string, boolean>;
  loaded: boolean;
  initError: string | null;
  snapshots: BalanceSnapshot[];
  refreshInterval: string;
  proxyMode: ProxyMode;
  proxyCustomUrl: string;
  proxyBypassRules: string;
  requestTimeout: string;
  petEnabled: boolean;
  monthlyBudgetUsd: string;
  pinnedIds: string[];
  hiddenIds: string[];
  proxyTesting: boolean;
  proxyTestResult: ProxyTestResult | null;
  usageRecords: UsageRecord[];
  usageRefreshing: boolean;
  pricingTable: PricingRowDisplay[];
  localUsageUnavailable: ScanLocalUsageResult["unavailable"];
  localUsageScanning: boolean;
  localDailyRecords: LocalDailyUsageRecord[];
  todayLocal: LocalDailyUsageRecord[];
  monthLocal: LocalDailyUsageRecord[];
  usageRange: "month" | "7d" | "30d" | "all";
  usageTab: "api" | "local";
  trendsRange: "7d" | "30d" | "all";
  trendsTab: "balance" | "local";
  trendsMetric: "tokens" | "cost";

  init: () => Promise<void>;
  loadServices: () => Promise<void>;
  /** 导入备份后重读服务清单、置顶/隐藏与预算（不触发厂商刷新） */
  reloadAfterBackupImport: () => Promise<void>;
  createService: (input: ServiceInput) => Promise<void>;
  updateService: (id: string, input: ServiceInput) => Promise<void>;
  deleteService: (id: string) => Promise<void>;
  refreshService: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  loadSnapshots: (since?: string) => Promise<void>;
  saveRefreshInterval: (min: number) => Promise<void>;
  saveProxyMode: (mode: ProxyMode) => Promise<void>;
  saveProxyCustomUrl: (url: string) => Promise<void>;
  saveProxyBypassRules: (rules: string) => Promise<void>;
  saveRequestTimeout: (sec: string) => Promise<void>;
  savePetEnabled: (on: boolean) => Promise<void>;
  saveMonthlyBudgetUsd: (value: string) => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
  toggleHidden: (id: string) => Promise<void>;
  testProxy: (override?: {
    mode?: string;
    customUrl?: string;
    bypassRules?: string;
  }) => Promise<ProxyTestResult>;
  loadUsage: (since?: string) => Promise<void>;
  refreshUsage: (id: string, period: { start: string; end: string }) => Promise<void>;
  refreshAllUsage: (period: { start: string; end: string }) => Promise<void>;
  loadPricing: () => Promise<void>;
  savePricing: (overrides: Record<string, Partial<ModelPricing>>) => Promise<void>;
  scanLocalUsage: (since?: string) => Promise<void>;
  loadLocalDaily: (since?: string) => Promise<void>;
  loadTodayLocal: () => Promise<void>;
  setUsageRange: (range: "month" | "7d" | "30d" | "all") => void;
  setUsageTab: (tab: "api" | "local") => void;
  setTrendsRange: (range: "7d" | "30d" | "all") => void;
  setTrendsTab: (tab: "balance" | "local") => void;
  setTrendsMetric: (metric: "tokens" | "cost") => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  definitions: [],
  services: [],
  balances: {},
  errors: {},
  refreshing: false,
  refreshingIds: {},
  loaded: false,
  initError: null,
  snapshots: [],
  refreshInterval: "5",
  proxyMode: "system",
  proxyCustomUrl: "",
  proxyBypassRules: DEFAULT_BYPASS,
  requestTimeout: "15",
  petEnabled: false,
  monthlyBudgetUsd: "",
  pinnedIds: [],
  hiddenIds: [],
  proxyTesting: false,
  proxyTestResult: null,
  usageRecords: [],
  usageRefreshing: false,
  pricingTable: [],
  localUsageUnavailable: [],
  localUsageScanning: false,
  localDailyRecords: [],
  todayLocal: [],
  monthLocal: [],
  usageRange: "month",
  usageTab: "api",
  trendsRange: "30d",
  trendsTab: "balance",
  trendsMetric: "tokens",

  init: async () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const boot = await ipc.bootstrap();
      set({
        initError: null,
        definitions: boot.definitions,
        services: boot.services,
        balances: boot.lastBalances,
        refreshInterval: boot.settings.refreshInterval || "5",
        proxyMode: (boot.settings.proxyMode as ProxyMode) || "system",
        proxyCustomUrl: boot.settings.proxyCustomUrl,
        proxyBypassRules: boot.settings.proxyBypassRules || DEFAULT_BYPASS,
        requestTimeout: boot.settings.requestTimeout || "15",
        petEnabled: boot.petEnabled,
        monthlyBudgetUsd: boot.settings.monthlyBudgetUsd ?? "",
        pinnedIds: parseIdList(boot.settings.pinnedServiceIds),
        hiddenIds: parseIdList(boot.settings.hiddenServiceIds),
        todayLocal: boot.todayLocal,
        monthLocal: boot.monthLocal ?? [],
        loaded: true,
      });

      // 监听后台自动刷新事件，更新总览页余额/错误
      if (!localUsageListenerRegistered) {
        localUsageListenerRegistered = true;
        ipc.onLocalUsageUpdated(() => {
          void get().loadTodayLocal();
        });
      }
      if (!balanceListenerRegistered) {
        balanceListenerRegistered = true;
        ipc.onBalanceUpdated((payload) => {
          set((state) => {
            const balances = { ...state.balances };
            const errors = { ...state.errors };
            if (payload.error) {
              errors[payload.id] = payload.error;
            } else if (payload.balance) {
              balances[payload.id] = payload.balance;
              errors[payload.id] = "";
            }
            return { balances, errors };
          });
        });
      }
      // 启动后立即刷新一次；卡片已经有上次数字，这次是覆盖
      void get().refreshAll();
    })().catch((e) => {
      initPromise = null;
      const msg = e instanceof Error ? e.message : String(e);
      set({ initError: msg, loaded: false });
    });
    return initPromise;
  },

  loadServices: async () => {
    const services = await ipc.listServices();
    set({ services });
  },

  reloadAfterBackupImport: async () => {
    try {
      const boot = await ipc.bootstrap();
      set({
        services: boot.services,
        pinnedIds: parseIdList(boot.settings.pinnedServiceIds),
        hiddenIds: parseIdList(boot.settings.hiddenServiceIds),
        monthlyBudgetUsd: boot.settings.monthlyBudgetUsd ?? "",
      });
    } catch (e) {
      reportError("reloadAfterBackupImport", e);
    }
  },

  createService: async (input) => {
    await ipc.createService(input);
    await get().loadServices();
  },

  updateService: async (id, input) => {
    await ipc.updateService(id, input);
    await get().loadServices();
  },

  deleteService: async (id) => {
    await ipc.deleteService(id);
    const pinnedIds = get().pinnedIds.filter((x) => x !== id);
    const hiddenIds = get().hiddenIds.filter((x) => x !== id);
    if (pinnedIds.length !== get().pinnedIds.length) {
      await ipc.setSetting("pinnedServiceIds", JSON.stringify(pinnedIds));
    }
    if (hiddenIds.length !== get().hiddenIds.length) {
      await ipc.setSetting("hiddenServiceIds", JSON.stringify(hiddenIds));
    }
    set((state) => {
      const balances = { ...state.balances };
      const errors = { ...state.errors };
      delete balances[id];
      delete errors[id];
      return {
        services: state.services.filter((s) => s.id !== id),
        balances,
        errors,
        pinnedIds,
        hiddenIds,
      };
    });
  },

  refreshService: async (id) => {
    set((state) => ({
      refreshingIds: { ...state.refreshingIds, [id]: true },
    }));
    try {
      const balance = await ipc.refreshService(id);
      set((state) => ({
        balances: { ...state.balances, [id]: balance },
        errors: { ...state.errors, [id]: "" },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((state) => ({ errors: { ...state.errors, [id]: msg } }));
    } finally {
      set((state) => {
        const refreshingIds = { ...state.refreshingIds };
        delete refreshingIds[id];
        return { refreshingIds };
      });
    }
  },

  refreshAll: async () => {
    const services = get().services;
    set({
      refreshing: true,
      refreshingIds: Object.fromEntries(services.map((s) => [s.id, true])),
    });
    try {
      await Promise.allSettled(services.map((s) => get().refreshService(s.id)));
      const { errors } = get();
      const failed = services.filter((s) => errors[s.id]);
      const msg = refreshFailureMessage(services.length, failed.length);
      if (msg) showToast(msg, "err");
    } finally {
      set({ refreshing: false });
    }
  },

  loadSnapshots: async (since) => {
    const seq = ++snapshotSeq;
    const snapshots = await ipc.listSnapshots(undefined, since);
    if (seq !== snapshotSeq) return;
    set({ snapshots });
  },

  saveRefreshInterval: async (min) => {
    const value = String(min);
    await ipc.setSetting("refreshInterval", value);
    set({ refreshInterval: value });
  },

  saveProxyMode: async (mode) => {
    await ipc.setSetting("proxyMode", mode);
    set({ proxyMode: mode });
  },

  saveProxyCustomUrl: async (url) => {
    await ipc.setSetting("proxyCustomUrl", url);
    set({ proxyCustomUrl: url });
  },

  saveProxyBypassRules: async (rules) => {
    await ipc.setSetting("proxyBypassRules", rules);
    set({ proxyBypassRules: rules });
  },

  saveRequestTimeout: async (sec) => {
    await ipc.setSetting("requestTimeout", sec);
    set({ requestTimeout: sec });
  },

  savePetEnabled: async (on) => {
    await ipc.setPetEnabled(on);
    set({ petEnabled: on });
  },

  saveMonthlyBudgetUsd: async (value) => {
    await ipc.setSetting("monthlyBudgetUsd", value);
    set({ monthlyBudgetUsd: value });
  },

  togglePinned: async (id) => {
    const pinnedIds = toggleId(get().pinnedIds, id);
    await ipc.setSetting("pinnedServiceIds", JSON.stringify(pinnedIds));
    set({ pinnedIds });
  },

  toggleHidden: async (id) => {
    const hiddenIds = toggleId(get().hiddenIds, id);
    await ipc.setSetting("hiddenServiceIds", JSON.stringify(hiddenIds));
    set({ hiddenIds });
  },

  testProxy: async (override) => {
    set({ proxyTesting: true });
    try {
      const result = await ipc.testProxy(override);
      set({ proxyTestResult: result });
      return result;
    } finally {
      set({ proxyTesting: false });
    }
  },

  loadUsage: async (since) => {
    const seq = ++usageSeq;
    const records = await ipc.listUsage(undefined, since);
    if (seq !== usageSeq) return;
    set({ usageRecords: records });
  },

  refreshUsage: async (id, period) => {
    try {
      await ipc.refreshUsage(id, period);
      set((state) => ({ errors: { ...state.errors, [id]: "" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((state) => ({ errors: { ...state.errors, [id]: msg } }));
    }
  },

  refreshAllUsage: async (period) => {
    set({ usageRefreshing: true });
    try {
      const { services, definitions } = get();
      const supported = services.filter((s) =>
        definitions.some((d) => d.provider === s.provider && d.supportsUsage),
      );
      await Promise.allSettled(supported.map((s) => get().refreshUsage(s.id, period)));
      const { errors } = get();
      const failed = supported.filter((s) => errors[s.id]);
      const msg = usageRefreshFailureMessage(supported.length, failed.length);
      if (msg) showToast(msg, "err");
    } finally {
      set({ usageRefreshing: false });
    }
  },

  loadPricing: async () => {
    const table = await ipc.getPricingTable();
    set({ pricingTable: table });
  },

  savePricing: async (overrides) => {
    await ipc.savePricingOverrides(overrides);
    const table = await ipc.getPricingTable();
    set({ pricingTable: table });
  },

  scanLocalUsage: async (since) => {
    set({ localUsageScanning: true });
    try {
      const result = await ipc.scanLocalUsage(since);
      set({
        localUsageUnavailable: result.unavailable,
      });
      // 扫描已在主进程 upsert 落盘，重载持久化历史供趋势/历史明细
      const seq = ++localDailySeq;
      const records = await ipc.listLocalDaily(since);
      if (seq !== localDailySeq) return;
      set({ localDailyRecords: records });
      void get().loadTodayLocal();
      const unexpected = result.unavailable.filter((u) => u.reason !== "已在设置中关闭");
      if (unexpected.length > 0) {
        showToast(`${unexpected.map((u) => u.reason).join("；")}`, "err");
      }
    } catch (e) {
      reportError("scanLocalUsage", e);
      throw e;
    } finally {
      set({ localUsageScanning: false });
    }
  },

  loadLocalDaily: async (since) => {
    const seq = ++localDailySeq;
    const records = await ipc.listLocalDaily(since);
    if (seq !== localDailySeq) return;
    set({ localDailyRecords: records });
  },

  loadTodayLocal: async () => {
    const today = localDateKey();
    const monthStart = `${today.slice(0, 7)}-01`;
    const weekStart = addDateKey(today, -13);
    const start = weekStart < monthStart ? weekStart : monthStart;
    const records = await ipc.listLocalDaily(start, today);
    set({
      monthLocal: records,
      todayLocal: records.filter((r) => r.date === today),
    });
  },

  setUsageRange: (usageRange) => set({ usageRange }),
  setUsageTab: (usageTab) => set({ usageTab }),
  setTrendsRange: (trendsRange) => set({ trendsRange }),
  setTrendsTab: (trendsTab) => set({ trendsTab }),
  setTrendsMetric: (trendsMetric) => set({ trendsMetric }),
}));
