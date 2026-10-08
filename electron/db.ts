import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { encrypt, decrypt } from "./secrets";
import type {
  ServiceRecord,
  BalanceSnapshot,
  BalanceResult,
  UsageRecord,
  UsageItem,
  LocalDailyUsageRecord,
} from "./types";
import type { LocalSource, LocalUsageRow } from "./local-usage/types";
import { toDateKey } from "./local-usage/date";
import { logWarn } from "./lib/logger";

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
  /**
   * 每个服务最近一次刷新成功的完整卡片结果（不含 raw）。
   * 趋势页继续用 balanceSnapshots 的数字序列；总览重启后要立刻画出
   * breakdown / statusLabel，快照里没有这些字段。
   */
  lastBalances: Record<string, BalanceResult>;
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
    lastBalances: {},
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

/**
 * 读取数据文件；文件存在但不可用时，先改名留档再以空数据启动。
 *
 * 直接 `data = defaultData()` 的代价是用户全部服务配置与已加密的密钥静默消失，
 * 而且下一次落盘就把坏文件覆盖掉，连人工抢救的机会都没有。改名留档之后，
 * 至少还留着一份原始文件，用户拿着它有机会把密钥捞回来。
 *
 * 结构不全也算不可用：services 是所有读写的前提，缺了它应用会在第一次
 * listServices 就抛异常，表现成窗口打开即报错。
 */
function loadDataFile(): StoreData {
  if (!fs.existsSync(filePath)) return defaultData();

  let reason = "";
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<StoreData>;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.services)) {
      return parsed as StoreData;
    }
    reason = "结构不符（services 不是数组）";
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }

  const backup = `${filePath}.corrupt-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  try {
    fs.renameSync(filePath, backup);
    logWarn("db", `数据文件不可用（${reason}），已留档到 ${backup}，以空数据启动`);
  } catch (e) {
    // 留档失败也必须能启动：一个坏文件不该把应用卡在启动阶段
    logWarn("db", `数据文件不可用（${reason}）且留档失败，以空数据启动: ${String(e)}`);
  }
  return defaultData();
}

/**
 * 用指定路径初始化存储。
 *
 * 与 initDb 拆开是为了能在测试里指向临时文件——否则这个模块的每一行逻辑都
 * 要先满足 Electron 的 app.getPath 才能跑，而它恰恰是最不该没有测试的模块：
 * 用户的全部服务配置、密钥密文和历史数据都在它手上。
 */
export function initDbAt(dbFilePath: string): void {
  filePath = dbFilePath;
  data = loadDataFile();

  // 兼容旧数据文件：逐个补齐缺失的集合字段。
  //
  // 必须补全，不能只补当初想到的那两个（localDailyUsage / counters）：
  // compactData 紧接着就会遍历 balanceSnapshots 和 usageRecords，缺任何一个
  // 都会在启动阶段抛 TypeError，而 app.whenReady().then() 没有 catch——
  // 用户看到的是「应用打不开」，日志里只有一句类型错误。同样的道理，
  // counters 的三个计数缺一个就会让 += 1 变成 NaN。
  //
  // 这条路是可达的：旧版本写下的文件本就可能少字段，README 还专门教用户
  // 手工去编辑这个文件来抢救数据。
  if (!Array.isArray(data.services)) data.services = [];
  if (!data.secrets || typeof data.secrets !== "object") data.secrets = {};
  if (!Array.isArray(data.balanceSnapshots)) data.balanceSnapshots = [];
  if (!Array.isArray(data.usageRecords)) data.usageRecords = [];
  if (!Array.isArray(data.localDailyUsage)) data.localDailyUsage = [];
  if (
    !data.lastBalances ||
    typeof data.lastBalances !== "object" ||
    Array.isArray(data.lastBalances)
  ) {
    data.lastBalances = {};
  } else {
    // 旧数据若误把 raw 写进去了，读的时候剥掉，下次落盘即自愈
    for (const [id, bal] of Object.entries(data.lastBalances)) {
      if (bal && typeof bal === "object" && "raw" in bal) {
        data.lastBalances[id] = stripRaw(bal);
      }
    }
  }
  if (!data.settings || typeof data.settings !== "object") data.settings = {};
  if (!data.counters || typeof data.counters !== "object") {
    data.counters = { balanceSnapshot: 0, usageRecord: 0, localDailyUsage: 0 };
  }
  if (data.counters.balanceSnapshot == null) data.counters.balanceSnapshot = 0;
  if (data.counters.usageRecord == null) data.counters.usageRecord = 0;
  if (data.counters.localDailyUsage == null) data.counters.localDailyUsage = 0;

  // 启动时压缩一次旧数据并落盘（同时把旧版 pretty-print 格式转成紧凑格式）
  compactData();
  persist();
  flushDb();
}

/** 应用启动时调用 */
export function initDb(): void {
  initDbAt(path.join(app.getPath("userData"), "token-lens-data.json"));
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
  delete data.lastBalances[id];
  persist();
}

function stripRaw(balance: BalanceResult): BalanceResult {
  const { raw: _raw, ...rest } = balance;
  return rest;
}

/** 刷新成功后写入，供下次启动立刻画出卡片。raw 不落盘。 */
export function saveLastBalance(serviceId: string, balance: BalanceResult): void {
  if (!data.lastBalances || typeof data.lastBalances !== "object") {
    data.lastBalances = {};
  }
  data.lastBalances[serviceId] = stripRaw(balance);
  persist();
}

export function getLastBalances(): Record<string, BalanceResult> {
  return { ...(data.lastBalances ?? {}) };
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
    } catch (e) {
      // 解密失败（换机器、数据损坏、系统加密不可用）时跳过该字段，但必须留痕。
      //
      // 不留痕的话，用户看到的是适配器抛出的「缺少 API Key」——他明明填过，
      // 却没有任何线索说明密钥为什么不见了，只会以为是应用出了问题或自己没保存。
      // 日志里写清是哪个服务的哪个字段，也只写这些：密文与明文都不落盘。
      logWarn(
        "db",
        `服务 ${serviceId} 的密钥字段 ${k} 解密失败，已跳过：${String(e)}`,
      );
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
  // 没有数字就不落盘。
  //
  // 快照唯一的消费者是趋势页，而它明确跳过 balance == null 的点
  // （Trends.tsx 的 pivot 里第一句就是 continue）——也就是说这类行永远画不出来，
  // 只占体积。而它们来得并不少：仅校验 Key 的三家适配器（Gemini / Groq /
  // Together）每次刷新都走到这里且恒无数字，按默认 5 分钟间隔、7 天全量保留算，
  // 光它们就能堆出六千行空值，而整份 JSON 每落盘一次都要全量重写。
  //
  // NaN 一并挡掉：JSON.stringify(NaN) 会写成 null，落盘等于记了个空值，
  // 但计数器已经加过，看着像存了其实没存。0 是合法余额，必须放行。
  if (balance == null || !Number.isFinite(balance)) return;

  data.counters.balanceSnapshot += 1;
  data.balanceSnapshots.push({
    id: data.counters.balanceSnapshot,
    serviceId,
    balance,
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

/**
 * 用一次全量扫描结果替换某来源的全部每日桶。
 * 只 upsert 会留下「新口径下不再出现的日期」，虚高历史清不掉。
 */
export function replaceLocalDailyUsageBySource(
  source: LocalSource,
  rows: LocalUsageRow[],
): void {
  if (!data) data = defaultData();
  data.localDailyUsage = data.localDailyUsage.filter((r) => r.source !== source);
  upsertLocalDailyUsage(rows);
}

/**
 * 清空全部本地每日用量桶（设置页「清除用量缓存」用）。
 *
 * 必须走这里，不能像原先那样直接读改写 token-lens-data.json：那份数据的权威
 * 副本是 db 的内存状态，绕过它写盘会让文件与内存各持一份不同内容，之后任何
 * 一次 persist（防抖 250ms 就会触发）都会把内存里的旧数据盖回去，
 * 清除结果变成时序抽奖。
 */
export function clearAllLocalDailyUsage(): void {
  if (!data) data = defaultData();
  data.localDailyUsage = [];
  persist();
}

/** 本地日期键 YYYY-MM-DD */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 把范围参数归一成本地日期键。
 *
 * 已经是日期键的原样返回：toDateKey 走 `new Date("YYYY-MM-DD")`，那是按 UTC 零点
 * 解析的，在 UTC 以西的时区取本地年月日会退回前一天，范围查询就会少一天。
 * 注释一直写着「支持 ISO 或 dateKey」，但实现只对 ISO 成立。
 */
function toRangeKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return DATE_KEY_RE.test(value) ? value : toDateKey(value);
}

/** 查询本地 agent 每日用量（按 date 范围；since/until 支持 ISO 或 dateKey） */
export function listLocalDailyUsage(
  since?: string,
  until?: string,
): LocalDailyUsageRecord[] {
  // r.date 是本地日期键，故范围也要转成本地日期键，避免边界多一天
  const sinceKey = toRangeKey(since);
  const untilKey = toRangeKey(until);
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

export function dataStats(): {
  services: number;
  usageRecords: number;
  localDaily: number;
  snapshots: number;
  bytes: number;
} {
  let bytes = 0;
  try {
    if (filePath && fs.existsSync(filePath)) bytes = fs.statSync(filePath).size;
  } catch (e) {
    logWarn(
      "db",
      `读取数据文件大小失败：${e instanceof Error ? e.message : String(e)}`,
    );
    bytes = 0;
  }
  return {
    services: data?.services.length ?? 0,
    usageRecords: data?.usageRecords.length ?? 0,
    localDaily: data?.localDailyUsage.length ?? 0,
    snapshots: data?.balanceSnapshots.length ?? 0,
    bytes,
  };
}

/** 标记 / 清除「需重新填写密钥」（备份恢复的服务补全密钥后清除）。 */
export function setNeedsCredentials(id: string, value: boolean): void {
  const s = data.services.find((x) => x.id === id);
  if (!s) return;
  if (value) s.needsCredentials = true;
  else delete s.needsCredentials;
  persist();
}

/** 备份里的一条服务清单（只有清单字段，不含 config 与密钥） */
export interface BackupServiceRow {
  id: string;
  name: string;
  provider: string;
  kind?: unknown;
  createdAt?: unknown;
}

export interface ImportServicesResult {
  /** 备份里的服务 id -> 本机服务 id */
  idMap: Map<string, string>;
  /** 新建（需重新填写密钥）的服务数 */
  restored: number;
  /** 与本机已有服务对上的数（同 id，或同类型同名） */
  matched: number;
  /** 服务类型本版本不认识、未恢复的数 */
  skipped: number;
}

/**
 * 导入备份里的服务清单。
 *
 * 对应规则：
 * 1. 本机已有同 id 的服务：视为同一个（同一台机器导回自己的备份），不改动；
 * 2. 导入**之前**本机就有的同类型、同名服务：视为用户已手工重建过，对到它上面。
 *    只看导入前就存在的服务，本次导入新建的不参与；且每个本机服务最多被一条
 *    备份服务对上——同一份备份里两个同名账号（如两个都叫「DeepSeek」的号）
 *    不会被并成一个，用量也就不会叠加双计；
 * 3. 否则按备份里的 id 新建，config 为空、不带密钥，标记 needsCredentials。
 *    沿用原 id 是为了让用量记录、置顶/隐藏列表不用改写就能对上，
 *    也让重复导入天然幂等（第二次全部落到规则 1）。
 * 规则 1 先于规则 2 整体跑一遍，免得排在前面的同名条目抢走后面同 id 条目的本机服务。
 * 服务类型不认识（resolveKind 返回 undefined）或条目残缺的跳过，其用量记录随之跳过。
 */
export function importBackupServices(
  rows: BackupServiceRow[],
  resolveKind: (provider: string) => ServiceRecord["kind"] | undefined,
): ImportServicesResult {
  if (!data) data = defaultData();
  const idMap = new Map<string, string>();
  const byId = new Map(data.services.map((s) => [s.id, s]));
  // 规则 2 的候选：只取导入前就存在的服务，同 key 可能有多个（按创建时间排）
  const byKey = new Map<string, ServiceRecord[]>();
  for (const s of listServices()) {
    const key = `${s.provider}|${s.name}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  /** 已被某条备份服务对上的本机服务 id（规则 1 或 2） */
  const claimed = new Set<string>();
  let restored = 0;
  let matched = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const valid: { row: BackupServiceRow; kind: ServiceRecord["kind"] }[] = [];
  for (const row of rows) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 200 ||
      typeof row.provider !== "string" ||
      typeof row.name !== "string"
    ) {
      skipped += 1;
      continue;
    }
    const kind = resolveKind(row.provider);
    if (!kind) {
      skipped += 1;
      continue;
    }
    valid.push({ row, kind });
  }

  // 规则 1：同 id
  const rest: typeof valid = [];
  for (const v of valid) {
    const sameId = byId.get(v.row.id);
    if (sameId) {
      idMap.set(v.row.id, sameId.id);
      claimed.add(sameId.id);
      matched += 1;
    } else {
      rest.push(v);
    }
  }

  for (const { row, kind } of rest) {
    // 备份里重复出现的同一个 id（前面已新建过）：同一个服务
    const created = idMap.get(row.id);
    if (created) {
      matched += 1;
      continue;
    }
    const name = row.name.trim().slice(0, 100) || row.provider;
    // 规则 2：导入前就有、且还没被别的备份服务对上的同类型同名服务
    const candidate = byKey
      .get(`${row.provider}|${name}`)
      ?.find((s) => !claimed.has(s.id));
    if (candidate) {
      idMap.set(row.id, candidate.id);
      claimed.add(candidate.id);
      matched += 1;
      continue;
    }
    // 规则 3：新建
    const createdAt =
      typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt))
        ? row.createdAt
        : now;
    const record: ServiceRecord = {
      id: row.id,
      name,
      provider: row.provider,
      kind,
      config: {},
      createdAt,
      updatedAt: now,
      needsCredentials: true,
    };
    data.services.push(record);
    idMap.set(row.id, record.id);
    claimed.add(record.id);
    restored += 1;
  }
  if (restored) persist();
  return { idMap, restored, matched, skipped };
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function usageContentKey(r: {
  serviceId: string;
  model: string | null;
  normalizedModel: string | null;
  cost: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  currency: string | null;
  recordedAt: string;
}): string {
  return JSON.stringify([
    r.serviceId,
    r.model,
    r.normalizedModel,
    r.cost,
    r.promptTokens,
    r.completionTokens,
    r.totalTokens,
    r.currency,
    r.recordedAt,
  ]);
}

/**
 * 导入备份里的 API 用量记录：映射到本机服务，按自然键去重，不复用旧 id。
 *
 * 去重单位与 saveUsageRecords 一致：(服务, 周期) 是一整组——刷新时同服务同周期
 * 先清旧再写新，所以组内可以有多行（按模型拆），而同一组只该有一份。
 * 本机已有某组时整组跳过（本机数据是在这台机器上刷出来的，以它为准），
 * 没有时整组写入。这样重复导入同一份备份不会翻倍，也不会和本机已有的
 * 同周期数据叠加双计。缺 period 的旧行退回按整行内容去重。
 *
 * serviceId 先查 idMap（备份服务 -> 本机服务），查不到但本机有同 id 服务的
 * 原样使用（兼容不带 services 字段的旧备份导回原机器），都没有的跳过。
 */
export function importUsageRecords(
  rows: unknown[],
  idMap: Map<string, string> = new Map(),
): { imported: number; skipped: number } {
  if (!data) data = defaultData();
  const localIds = new Set(data.services.map((s) => s.id));
  const existingUnits = new Set<string>();
  const existingContent = new Set<string>();
  for (const r of data.usageRecords) {
    if (r.period != null) existingUnits.add(`${r.serviceId}|${r.period}`);
    else existingContent.add(usageContentKey(r));
  }

  const batchContent = new Set<string>();
  /** 本次导入里每个 (服务, 周期) 组来自哪个备份服务 id */
  const unitOwner = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const item of rows) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const it = item as Record<string, unknown>;
    const rawId = typeof it.serviceId === "string" ? it.serviceId : "";
    const serviceId =
      (rawId && idMap.get(rawId)) || (rawId && localIds.has(rawId) ? rawId : "");
    if (!serviceId) {
      skipped += 1;
      continue;
    }
    const period = typeof it.period === "string" && it.period ? it.period : null;
    const rec = {
      serviceId,
      model: typeof it.model === "string" ? it.model : null,
      normalizedModel:
        typeof it.normalizedModel === "string" ? it.normalizedModel : null,
      cost: finiteOrNull(it.cost),
      promptTokens: finiteOrNull(it.promptTokens),
      completionTokens: finiteOrNull(it.completionTokens),
      totalTokens: finiteOrNull(it.totalTokens),
      period,
      currency: typeof it.currency === "string" ? it.currency : null,
      recordedAt:
        typeof it.recordedAt === "string" && Number.isFinite(Date.parse(it.recordedAt))
          ? it.recordedAt
          : now,
    };
    const key = usageContentKey(rec);
    if (period != null) {
      const unit = `${serviceId}|${period}`;
      // 只拿导入前的本机状态判断：同一组在本次导入里的多行要一起写进去。
      // 但完全相同的行只留一份：旧版导入会原样追加，导出的备份里可能已有重复。
      // 同一 (服务, 周期) 只认第一个写入它的备份服务：万一两条备份服务映射到
      // 同一个本机服务，也不会写出两组同周期用量叠加双计。
      const owner = unitOwner.get(unit);
      if (
        existingUnits.has(unit) ||
        (owner !== undefined && owner !== rawId) ||
        batchContent.has(key)
      ) {
        skipped += 1;
        continue;
      }
      unitOwner.set(unit, rawId);
      batchContent.add(key);
    } else {
      if (existingContent.has(key)) {
        skipped += 1;
        continue;
      }
      existingContent.add(key);
    }
    data.counters.usageRecord += 1;
    data.usageRecords.push({ id: data.counters.usageRecord, ...rec });
    imported += 1;
  }
  if (imported) persist();
  return { imported, skipped };
}
