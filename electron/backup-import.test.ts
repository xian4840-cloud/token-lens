import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  flushDb,
  getService,
  getSetting,
  initDbAt,
  insertService,
  listServices,
  listUsageRecords,
  saveUsageRecords,
  setNeedsCredentials,
  setSetting,
} from "./db";
import { applyBackupImport } from "./backup-import";
import {
  buildBackupPayload,
  NEEDS_CREDENTIALS_MESSAGE,
  parseBackupJson,
  type BackupPayload,
} from "./lib/backup";
import { refreshServiceInternal } from "./refresh";
import { refreshUsageInternal } from "./usage";
import { mapErrorToUserMessage } from "./lib/user-error";
import type { ServiceKind, ServiceRecord } from "./types";

/**
 * 备份导入的端到端行为：服务清单恢复、用量映射、重复导入幂等、旧格式兼容。
 * 走真实的 db（临时文件）+ 真实的 parseBackupJson，只把适配器注册表换成桩。
 */

const KINDS: Record<string, ServiceKind> = {
  deepseek: "api",
  openai: "api",
  zhipu_plan: "plan",
};
const resolveKind = (p: string): ServiceKind | undefined => KINDS[p];

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-import-"));
  initDbAt(path.join(dir, "data.json"));
});

afterEach(() => {
  flushDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

function svc(id: string, provider = "deepseek", name = `svc-${id}`): ServiceRecord {
  return {
    id,
    name,
    provider,
    kind: KINDS[provider] ?? "api",
    config: { region: "cn" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function parse(raw: string): BackupPayload {
  const r = parseBackupJson(raw);
  if (!r.ok) throw new Error(r.error);
  return r.payload;
}

/** 模拟另一台机器导出的备份 */
function exportedBackup(): string {
  return JSON.stringify(
    buildBackupPayload({
      services: [svc("a", "deepseek", "DS 工作号"), svc("b", "openai", "OpenAI")],
      usageRecords: [
        { id: 1, serviceId: "a", model: "deepseek-chat", cost: 1.5, totalTokens: 100, period: "2026-09-01|2026-09-30", currency: "CNY", recordedAt: "2026-09-30T00:00:00.000Z" },
        { id: 2, serviceId: "a", model: "deepseek-reasoner", cost: 2, totalTokens: 50, period: "2026-09-01|2026-09-30", currency: "CNY", recordedAt: "2026-09-30T00:00:00.000Z" },
        { id: 3, serviceId: "b", model: "gpt-5", cost: 3, totalTokens: 10, period: "2026-09-01|2026-09-30", currency: "USD", recordedAt: "2026-09-30T00:00:00.000Z" },
      ],
      localDailyUsage: [
        { source: "codex", model: "gpt-5", date: "2026-09-02", inputTokens: 5 },
      ],
      settings: {
        monthlyBudgetUsd: "50",
        pinnedServiceIds: JSON.stringify(["b"]),
        hiddenServiceIds: JSON.stringify(["a"]),
      },
      exportedAt: "2026-10-01T00:00:00.000Z",
    }),
  );
}

describe("applyBackupImport：恢复服务清单", () => {
  it("新机器导入：按原 id 恢复服务，不带 config 与密钥，并标记需重新填写密钥", () => {
    const r = applyBackupImport(parse(exportedBackup()), resolveKind);
    expect(r).toMatchObject({ services: 2, servicesMatched: 0, servicesSkipped: 0, usage: 3, usageSkipped: 0, local: 1 });

    const a = getService("a");
    expect(a).toMatchObject({ name: "DS 工作号", provider: "deepseek", kind: "api", needsCredentials: true });
    expect(a?.config).toEqual({});
    // 备份里的 config 本来就被丢掉了，这里再确认没有任何密钥写进存储
    flushDb();
    const disk = fs.readFileSync(path.join(dir, "data.json"), "utf8");
    expect(JSON.parse(disk).secrets).toEqual({});
    expect(disk).not.toContain("region");

    // 用量记录挂在恢复出来的服务上
    const byService = listUsageRecords().map((u) => u.serviceId).sort();
    expect(byService).toEqual(["a", "a", "b"]);
    // 置顶/隐藏随服务一起恢复
    expect(JSON.parse(getSetting("pinnedServiceIds") ?? "[]")).toEqual(["b"]);
    expect(JSON.parse(getSetting("hiddenServiceIds") ?? "[]")).toEqual(["a"]);
    expect(getSetting("monthlyBudgetUsd")).toBe("50");
  });

  it("重复导入同一份备份是幂等的：服务、用量都不翻倍", () => {
    const raw = exportedBackup();
    applyBackupImport(parse(raw), resolveKind);
    const second = applyBackupImport(parse(raw), resolveKind);
    expect(second).toMatchObject({ services: 0, servicesMatched: 2, usage: 0, usageSkipped: 3 });
    expect(listServices()).toHaveLength(2);
    expect(listUsageRecords()).toHaveLength(3);
    expect(JSON.parse(getSetting("pinnedServiceIds") ?? "[]")).toEqual(["b"]);
  });

  it("本机已手工重建同类型同名服务：对到它上面，用量映射到本机 id", () => {
    insertService(svc("local-1", "deepseek", "DS 工作号"));
    const r = applyBackupImport(parse(exportedBackup()), resolveKind);
    expect(r).toMatchObject({ services: 1, servicesMatched: 1 });
    expect(getService("a")).toBeUndefined();
    expect(getService("local-1")?.needsCredentials).toBeUndefined();
    const ids = listUsageRecords().map((u) => u.serviceId).sort();
    expect(ids).toEqual(["b", "local-1", "local-1"]);
    // 隐藏列表里的 "a" 换成了本机 id
    expect(JSON.parse(getSetting("hiddenServiceIds") ?? "[]")).toEqual(["local-1"]);
  });

  it("同机导回：同 id 服务保持原样（不覆盖名称、不打标记）", () => {
    insertService({ ...svc("a"), name: "我改过的名字" });
    applyBackupImport(parse(exportedBackup()), resolveKind);
    expect(getService("a")).toMatchObject({ name: "我改过的名字", config: { region: "cn" } });
    expect(getService("a")?.needsCredentials).toBeUndefined();
  });

  it("本机已有同服务同周期的用量时以本机为准，不叠加", () => {
    insertService(svc("a"));
    saveUsageRecords("a", [{ model: "deepseek-chat", cost: 9, totalTokens: 999 }], "2026-09-01|2026-09-30", "CNY");
    applyBackupImport(parse(exportedBackup()), resolveKind);
    const aRows = listUsageRecords("a");
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.cost).toBe(9);
  });

  it("不认识的服务类型跳过，其用量随之跳过", () => {
    const raw = JSON.stringify({
      ...JSON.parse(exportedBackup()),
      services: [{ id: "x", name: "未来服务", provider: "future_vendor", kind: "api", createdAt: "t" }],
      usageRecords: [{ serviceId: "x", model: "m", period: "p" }],
    });
    const r = applyBackupImport(parse(raw), resolveKind);
    expect(r).toMatchObject({ services: 0, servicesSkipped: 1, usage: 0, usageSkipped: 1 });
    expect(listServices()).toHaveLength(0);
  });

  it("备份里已有完全相同的重复行（旧版导入留下的）只写一份", () => {
    const row = { serviceId: "a", model: "m", cost: 1, period: "p1", recordedAt: "2026-09-30T00:00:00.000Z" };
    const raw = JSON.stringify({
      app: "token-lens",
      version: 1,
      services: [{ id: "a", name: "DS", provider: "deepseek" }],
      usageRecords: [row, row, { ...row, model: "m2" }],
      localDailyUsage: [],
    });
    const r = applyBackupImport(parse(raw), resolveKind);
    expect(r).toMatchObject({ usage: 2, usageSkipped: 1 });
  });
});

describe("applyBackupImport：旧格式兼容", () => {
  it("没有 services 字段的旧备份：用量挂到本机同 id 服务，找不到服务的跳过", () => {
    insertService(svc("a"));
    const raw = JSON.stringify({
      app: "token-lens",
      version: 1,
      exportedAt: "2026-09-12T00:00:00.000Z",
      usageRecords: [
        { serviceId: "a", model: "m", period: "p" },
        { serviceId: "gone", model: "m", period: "p" },
      ],
      localDailyUsage: [{ source: "claude-code", model: "c", date: "2026-09-01", inputTokens: 1 }],
      // 0.1.15 的备份没有 hiddenServiceIds
      settings: { pinnedServiceIds: JSON.stringify(["a", "gone"]) },
    });
    const r = applyBackupImport(parse(raw), resolveKind);
    expect(r).toMatchObject({ services: 0, usage: 1, usageSkipped: 1, local: 1 });
    expect(JSON.parse(getSetting("pinnedServiceIds") ?? "[]")).toEqual(["a"]);
  });

  it("服务条目残缺（缺 kind / createdAt）仍能恢复，缺 id/provider 的逐条丢弃", () => {
    const raw = JSON.stringify({
      app: "token-lens",
      version: 1,
      services: [
        { id: "z", name: "智谱", provider: "zhipu_plan" },
        { name: "没有 id", provider: "deepseek" },
        { id: "y", name: "没有 provider" },
        42,
      ],
      usageRecords: [],
      localDailyUsage: [],
    });
    const r = applyBackupImport(parse(raw), resolveKind);
    expect(r.services).toBe(1);
    const z = getService("z");
    expect(z).toMatchObject({ kind: "plan", needsCredentials: true });
    expect(Number.isFinite(Date.parse(z?.createdAt ?? ""))).toBe(true);
  });

  it("导入不冲掉本机原有的置顶", () => {
    insertService(svc("mine"));
    setSetting("pinnedServiceIds", JSON.stringify(["mine"]));
    applyBackupImport(parse(exportedBackup()), resolveKind);
    expect(JSON.parse(getSetting("pinnedServiceIds") ?? "[]")).toEqual(["mine", "b"]);
  });
});

describe("needsCredentials 标记", () => {
  it("setNeedsCredentials(false) 清掉标记并落盘", () => {
    applyBackupImport(parse(exportedBackup()), resolveKind);
    setNeedsCredentials("a", false);
    flushDb();
    const disk = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")) as {
      services: ServiceRecord[];
    };
    expect(disk.services.find((s) => s.id === "a")?.needsCredentials).toBeUndefined();
    expect(disk.services.find((s) => s.id === "b")?.needsCredentials).toBe(true);
  });
});

describe("恢复出来的服务在补全密钥前不打厂商接口", () => {
  it("刷新余额 / 用量直接给出可读提示，卡片上原样显示", async () => {
    applyBackupImport(parse(exportedBackup()), resolveKind);
    await expect(refreshServiceInternal("a")).rejects.toThrow(NEEDS_CREDENTIALS_MESSAGE);
    await expect(
      refreshUsageInternal("a", { start: "2026-09-01", end: "2026-09-30" }),
    ).rejects.toThrow(NEEDS_CREDENTIALS_MESSAGE);
    expect(mapErrorToUserMessage(new Error(NEEDS_CREDENTIALS_MESSAGE))).toBe(
      NEEDS_CREDENTIALS_MESSAGE,
    );
  });
});
