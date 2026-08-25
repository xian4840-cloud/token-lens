import { create } from "zustand";
import { ipc } from "@/lib/ipc";
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
  ProxyMode,
  ProxyTestResult,
} from "@/types";

/** 防止自动刷新监听重复注册（React StrictMode / 多页 init） */
let balanceListenerRegistered = false;

const DEFAULT_BYPASS =
  "<local>,*.cn,*.aliyuncs.com,*.volcengineapi.com,*.volcengine.com,*.moonshot.cn,*.minimax.chat,*.minimaxi.com,*.xiaomimimo.com,*.scnet.cn,*.siliconflow.cn";

interface AppState {
  definitions: ServiceDefinition[];
  services: ServiceRecord[];
  balances: Record<string, BalanceResult | undefined>;
  errors: Record<string, string>;
  refreshing: boolean;
  loaded: boolean;
  snapshots: BalanceSnapshot[];
  refreshInterval: string;
  proxyMode: ProxyMode;
  proxyCustomUrl: string;
  proxyBypassRules: string;
  requestTimeout: string;
  proxyTesting: boolean;
  proxyTestResult: ProxyTestResult | null;
  usageRecords: UsageRecord[];
  usageRefreshing: boolean;
  pricingTable: PricingRowDisplay[];
  localUsageRows: LocalUsageRow[];
  localUsageUnavailable: ScanLocalUsageResult["unavailable"];
  localUsageScanning: boolean;
  localDailyRecords: LocalDailyUsageRecord[];

  init: () => Promise<void>;
  loadServices: () => Promise<void>;
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
  testProxy: (override?: {
    mode?: string;
    customUrl?: string;
    bypassRules?: string;
  }) => Promise<ProxyTestResult>;
  loadUsage: (since?: string) => Promise<void>;
  refreshUsage: (
    id: string,
    period: { start: string; end: string },
  ) => Promise<void>;
  refreshAllUsage: (period: { start: string; end: string }) => Promise<void>;
  loadPricing: () => Promise<void>;
  savePricing: (
    overrides: Record<string, Partial<ModelPricing>>,
  ) => Promise<void>;
  scanLocalUsage: (since?: string) => Promise<void>;
  loadLocalDaily: (since?: string) => Promise<void>;
}


export const useAppStore = create<AppState>((set, get) => ({
  definitions: [],
  services: [],
  balances: {},
  errors: {},
  refreshing: false,
  loaded: false,
  snapshots: [],
  refreshInterval: "5",
  proxyMode: "system",
  proxyCustomUrl: "",
  proxyBypassRules: DEFAULT_BYPASS,
  requestTimeout: "15",
  proxyTesting: false,
  proxyTestResult: null,
  usageRecords: [],
  usageRefreshing: false,
  pricingTable: [],
  localUsageRows: [],
  localUsageUnavailable: [],
  localUsageScanning: false,
  localDailyRecords: [],

  init: async () => {
    const [
      definitions,
      services,
      refreshInterval,
      proxyMode,
      proxyCustomUrl,
      proxyBypassRules,
      requestTimeout,
    ] = await Promise.all([
      ipc.listDefinitions(),
      ipc.listServices(),
      ipc.getSetting("refreshInterval"),
      ipc.getSetting("proxyMode"),
      ipc.getSetting("proxyCustomUrl"),
      ipc.getSetting("proxyBypassRules"),
      ipc.getSetting("requestTimeout"),
    ]);
    set({
      definitions,
      services,
      refreshInterval: refreshInterval ?? "5",
      proxyMode: (proxyMode as ProxyMode) || "system",
      proxyCustomUrl: proxyCustomUrl ?? "",
      proxyBypassRules: proxyBypassRules ?? DEFAULT_BYPASS,
      requestTimeout: requestTimeout ?? "15",
      loaded: true,
    });

    // 监听后台自动刷新事件，更新总览页余额/错误
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
    // 启动后立即刷新一次（更新总览页余额 + 记录快照到趋势）
    void get().refreshAll();
  },

  loadServices: async () => {
    const services = await ipc.listServices();
    set({ services });
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
    set((state) => {
      const balances = { ...state.balances };
      const errors = { ...state.errors };
      delete balances[id];
      delete errors[id];
      return {
        services: state.services.filter((s) => s.id !== id),
        balances,
        errors,
      };
    });
  },

  refreshService: async (id) => {
    try {
      const balance = await ipc.refreshService(id);
      set((state) => ({
        balances: { ...state.balances, [id]: balance },
        errors: { ...state.errors, [id]: "" },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((state) => ({ errors: { ...state.errors, [id]: msg } }));
    }
  },

  refreshAll: async () => {
    set({ refreshing: true });
    try {
      const services = get().services;
      await Promise.allSettled(services.map((s) => get().refreshService(s.id)));
    } finally {
      set({ refreshing: false });
    }
  },

  loadSnapshots: async (since) => {
    const snapshots = await ipc.listSnapshots(undefined, since);
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
    const records = await ipc.listUsage(undefined, since);
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
        definitions.some(
          (d) => d.provider === s.provider && d.supportsUsage,
        ),
      );
      await Promise.allSettled(
        supported.map((s) => get().refreshUsage(s.id, period)),
      );
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
        localUsageRows: result.rows,
        localUsageUnavailable: result.unavailable,
      });
      // 扫描已在主进程 upsert 落盘，重载持久化历史供趋势/历史明细
      const records = await ipc.listLocalDaily(since);
      set({ localDailyRecords: records });
    } finally {
      set({ localUsageScanning: false });
    }
  },

  loadLocalDaily: async (since) => {
    const records = await ipc.listLocalDaily(since);
    set({ localDailyRecords: records });
  },
}));
