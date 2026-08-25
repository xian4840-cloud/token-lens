import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { encrypt, decrypt } from "./secrets";
import type {
  ServiceRecord,
  BalanceSnapshot,
  UsageRecord,
  UsageItem,
  LocalDailyUsageRecord,
} from "./types";
import type { LocalUsageRow } from "./local-usage/types";
import { toDateKey } from "./local-usage/date";

/**
 * 基于 JSON 文件的数据存储（无需 native 依赖）。
 * 数据量对个人工具型应用足够；写操作全量持久化，主进程单线程无并发问题。
 */

interface StoreData {
  services: ServiceRecord[];
  /** serviceId -> fieldKey -> base64 密文 */
  secrets: Record<string, Record<string, string>>;
  balanceSnapshots: BalanceSnapshot[];
  usageRecords: UsageRecord[];
  localDailyUsage: LocalDailyUsageRecord[];
  settings: Record<string, string>;
  counters: {
    balanceSnapshot: number;
    usageRecord: number;
    localDailyUsage: number;
  };
}

let data: StoreData;
let filePath = "";

function defaultData(): StoreData {
  return {
    services: [],
    secrets: {},
    balanceSnapshots: [],
    usageRecords: [],
    localDailyUsage: [],
    settings: {},
    counters: { balanceSnapshot: 0, usageRecord: 0, localDailyUsage: 0 },
  };
}

/** 7 天内的快照保留全量（趋势页细粒度图）；更早的按 (服务, 天) 只留最后一条 */
const SNAPSHOT_FULL_DAYS = 7;
/** 用量明细记录保留天数 */
const USAGE_RECORD_DAYS = 365;
/** 本地 agent 每日用量快照保留天数（按天粒度体积小，与 usageRecords 一致） */
const LOCAL_DAILY_DAYS = 365;
/** 每写多少次快照触发一次 compact（防止旧数据无限膨胀） */
const COMPACT_EVERY_SNAPSHOTS = 200;

/** 距上次触发 compact 的快照写入计数 */
let snapshotsSinceCompact = 0;
let persistTimer: NodeJS.Timeout | null = null;
let dirty = false;

/**
 * 防抖持久化：连续多次写合并为一次落盘（如批量刷新快照）。
 * 正常退出时由 main 进程 before-quit 调 flushDb 兜底。
 */
function persist(): void {
  dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushDb();
  }, 250);
}

/** 立即落盘。先写临时文件再 rename，进程中断也不会写坏原 JSON。 */
export function flushDb(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!dirty || !filePath) return;
  dirty = false;
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * 压缩历史数据，控制 JSON 文件体积与内存常驻：
 * - 快照：7 天外按 (serviceId, day) 降采样为每天最后一条（趋势 30d/全部按天显示，无视觉损失）
 * - 用量记录：仅保留最近 USAGE_RECORD_DAYS 天
 * - 本地 agent 每日用量：仅保留最近 LOCAL_DAILY_DAYS 天
 */
function compactData(): void {
  const now = Date.now();
  const snapCutoff = new Date(
    now - SNAPSHOT_FULL_DAYS * 86_400_000,
  ).toISOString();

  const recent: BalanceSnapshot[] = [];
  const dailyLast = new Map<string, BalanceSnapshot>();
  for (const s of data.balanceSnapshots) {
    if (s.recordedAt >= snapCutoff) {
      recent.push(s);
      continue;
    }
    const key = `${s.serviceId}|${s.recordedAt.slice(0, 10)}`;
    const prev = dailyLast.get(key);
    if (!prev || prev.recordedAt < s.recordedAt) dailyLast.set(key, s);
  }
  data.balanceSnapshots = [...dailyLast.values(), ...recent].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );

  const usageCutoff = new Date(
    now - USAGE_RECORD_DAYS * 86_400_000,
  ).toISOString();
  data.usageRecords = data.usageRecords.filter(
    (r) => r.recordedAt >= usageCutoff,
  );

  const localCutoffKey = toDateKey(now - LOCAL_DAILY_DAYS * 86_400_000);
  if (localCutoffKey) {
    data.localDailyUsage = data.localDailyUsage.filter(
      (r) => r.date >= localCutoffKey,
    );
  }
}

export function initDb(): void {
  filePath = path.join(app.getPath("userData"), "token-lens-data.json");
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf8")) as StoreData;
    } catch {
      data = defaultData();
    }
  } else {
    data = defaultData();
  }
  // 兼容旧数据文件：缺 localDailyUsage 字段时补默认
  if (!data.localDailyUsage) data.localDailyUsage = [];
  if (!data.counters) data.counters = { balanceSnapshot: 0, usageRecord: 0, localDailyUsage: 0 };
  if (data.counters.localDailyUsage == null) data.counters.localDailyUsage = 0;
  // 启动时压缩一次旧数据并落盘（同时把旧版 pretty-print 格式转成紧凑格式）
  compactData();
  persist();
  flushDb();
}

// ---- services ----

export function listServices(): ServiceRecord[] {
  return [...data.services].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getService(id: string): ServiceRecord | undefined {
  return data.services.find((s) => s.id === id);
}

export function insertService(record: ServiceRecord): void {
  data.services.push(record);
  persist();
}

export function updateServiceMeta(
  id: string,
  name: string,
  config: Record<string, unknown>,
): void {
  const s = data.services.find((x) => x.id === id);
  if (s) {
    s.name = name;
    s.config = config;
    s.updatedAt = new Date().toISOString();
    persist();
  }
}

export function deleteServiceRow(id: string): void {
  data.services = data.services.filter((s) => s.id !== id);
  data.balanceSnapshots = data.balanceSnapshots.filter((s) => s.serviceId !== id);
  data.usageRecords = data.usageRecords.filter((s) => s.serviceId !== id);
  delete data.secrets[id];
  persist();
}

// ---- secrets（safeStorage 加密，JSON 存 base64） ----

export function setSecret(serviceId: string, fieldKey: string, value: string): void {
  const b64 = encrypt(value).toString("base64");
  if (!data.secrets[serviceId]) data.secrets[serviceId] = {};
  data.secrets[serviceId][fieldKey] = b64;
  persist();
}

export function getSecrets(serviceId: string): Record<string, string> {
  const map = data.secrets[serviceId] ?? {};
  const result: Record<string, string> = {};
  for (const [k, b64] of Object.entries(map)) {
    try {
      result[k] = decrypt(Buffer.from(b64, "base64"));
    } catch {
      // 解密失败（换机器/损坏）跳过该字段
    }
  }
  return result;
}

export function deleteSecrets(serviceId: string): void {
  delete data.secrets[serviceId];
  persist();
}

// ---- balance snapshots ----

export function saveBalanceSnapshot(
  serviceId: string,
  balance: number | undefined,
  currency: string,
): void {
  data.counters.balanceSnapshot += 1;
  data.balanceSnapshots.push({
    id: data.counters.balanceSnapshot,
    serviceId,
    balance: balance ?? null,
    currency,
    recordedAt: new Date().toISOString(),
  });
  snapshotsSinceCompact += 1;
  if (snapshotsSinceCompact >= COMPACT_EVERY_SNAPSHOTS) {
    snapshotsSinceCompact = 0;
    compactData();
  }
  persist();
}

export function listBalanceSnapshots(
  serviceId?: string,
  since?: string,
): BalanceSnapshot[] {
  return data.balanceSnapshots.filter((s) => {
    if (serviceId && s.serviceId !== serviceId) return false;
    if (since && s.recordedAt < since) return false;
    return true;
  });
}

// ---- usage records ----

/**
 * 写入某服务某周期的用量记录。同服务同周期先清旧再写新，
 * 避免重复刷新累积重复数据。period 用 "start|end" 作去重键。
 */
export function saveUsageRecords(
  serviceId: string,
  items: UsageItem[],
  period: string,
  currency?: string,
): void {
  data.usageRecords = data.usageRecords.filter(
    (r) => !(r.serviceId === serviceId && r.period === period),
  );
  const now = new Date().toISOString();
  for (const it of items) {
    data.counters.usageRecord += 1;
    data.usageRecords.push({
      id: data.counters.usageRecord,
      serviceId,
      model: it.model ?? null,
      normalizedModel: it.normalizedModel ?? null,
      cost: it.cost ?? null,
      promptTokens: it.promptTokens ?? null,
      completionTokens: it.completionTokens ?? null,
      totalTokens: it.totalTokens ?? null,
      period,
      currency: currency ?? null,
      recordedAt: now,
    });
  }
  persist();
}

export function listUsageRecords(
  serviceId?: string,
  since?: string,
): UsageRecord[] {
  return data.usageRecords.filter((r) => {
    if (serviceId && r.serviceId !== serviceId) return false;
    if (since && r.recordedAt < since) return false;
    return true;
  });
}

// ---- local agent daily usage ----

/**
 * 写入本地 agent 每日用量快照。按 source+model+date 去重 upsert：
 * 今日桶每次扫描覆盖（用量随使用增长），历史桶幂等（那天的用量已定）。
 * cost/currency 为 undefined 时存 null（OpenCode 自带 cost，其它经 computeCost）。
 */
export function upsertLocalDailyUsage(rows: LocalUsageRow[]): void {
  const now = new Date().toISOString();
  const index = new Map<string, number>();
  for (let i = 0; i < data.localDailyUsage.length; i++) {
    const r = data.localDailyUsage[i];
    index.set(`${r.source}|${r.model}|${r.date}`, i);
  }
  for (const r of rows) {
    const key = `${r.source}|${r.model}|${r.date}`;
    const rec: LocalDailyUsageRecord = {
      id: 0,
      source: r.source,
      model: r.model,
      date: r.date,
      sessions: r.sessions,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheCreationTokens: r.cacheCreationTokens,
      cacheReadTokens: r.cacheReadTokens,
      reasoningTokens: r.reasoningTokens,
      cost: r.cost ?? null,
      currency: r.currency ?? null,
      firstAt: r.firstAt ?? null,
      lastAt: r.lastAt ?? null,
      scannedAt: now,
    };
    const idx = index.get(key);
    if (idx !== undefined) {
      rec.id = data.localDailyUsage[idx].id;
      data.localDailyUsage[idx] = rec;
    } else {
      data.counters.localDailyUsage += 1;
      rec.id = data.counters.localDailyUsage;
      data.localDailyUsage.push(rec);
      index.set(key, data.localDailyUsage.length - 1);
    }
  }
  persist();
}

/** 查询本地 agent 每日用量（按 date 范围；since/until 支持 ISO 或 dateKey） */
export function listLocalDailyUsage(
  since?: string,
  until?: string,
): LocalDailyUsageRecord[] {
  // since/until 是 UTC ISO，需转本地日期键与 r.date（本地键）一致，避免边界多一天
  const sinceKey = since ? toDateKey(since) : undefined;
  const untilKey = until ? toDateKey(until) : undefined;
  return data.localDailyUsage.filter((r) => {
    if (sinceKey && r.date < sinceKey) return false;
    if (untilKey && r.date > untilKey) return false;
    return true;
  });
}

// ---- settings ----

export function getSetting(key: string): string | undefined {
  return data?.settings?.[key];
}

export function setSetting(key: string, value: string): void {
  if (!data) data = defaultData();
  data.settings[key] = value;
  persist();
}

