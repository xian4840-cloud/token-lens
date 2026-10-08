import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 完整链路：备份恢复出来的服务（needsCredentials）-> 用户在编辑里补填密钥
 * （services:update，即 updateServiceFromInput）-> 标记清除 -> 刷新真正打到适配器。
 *
 * 只桩掉两处依赖 Electron / 网络的边界：safeStorage 加解密与 HTTP 请求；
 * db、适配器注册表、校验、刷新逻辑都是真的。
 */

const crypto = vi.hoisted(() => ({ available: true }));

vi.mock("./secrets", () => ({
  isEncryptionAvailable: () => crypto.available,
  encrypt: (text: string) => {
    // 与真实 secrets.ts 一致：系统加密不可用时抛错
    if (!crypto.available) throw new Error("系统加密不可用，无法安全存储密钥");
    return Buffer.from(`enc:${text}`, "utf8");
  },
  decrypt: (buf: Buffer) => buf.toString("utf8").replace(/^enc:/, ""),
}));

const http = vi.hoisted(() => ({
  calls: [] as { url: string; auth: string | undefined }[],
}));

vi.mock("./lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/http")>()),
  fetchWithTimeout: async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    http.calls.push({ url: String(url), auth: headers.Authorization ?? headers.authorization });
    const body = {
      is_available: true,
      balance_infos: [
        {
          currency: "CNY",
          total_balance: "12.34",
          granted_balance: "0.00",
          topped_up_balance: "12.34",
        },
      ],
    };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  },
}));

const { flushDb, getSecrets, getService, initDbAt, listServices } = await import("./db");
const { registerAllAdapters, getDefinition } = await import("./adapters");
const { applyBackupImport } = await import("./backup-import");
const { buildBackupPayload, NEEDS_CREDENTIALS_MESSAGE, parseBackupJson } =
  await import("./lib/backup");
const { refreshServiceInternal } = await import("./refresh");
const { createServiceFromInput, updateServiceFromInput } = await import("./service-update");

registerAllAdapters();

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-svc-update-"));
  initDbAt(path.join(dir, "data.json"));
  http.calls.length = 0;
  crypto.available = true;
});

afterEach(() => {
  flushDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

function restoreDeepseekFromBackup(): string {
  const raw = JSON.stringify(
    buildBackupPayload({
      services: [
        {
          id: "ds-1",
          name: "DeepSeek",
          provider: "deepseek",
          kind: "api",
          config: {},
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      usageRecords: [],
      localDailyUsage: [],
      settings: {},
      exportedAt: "2026-10-01T00:00:00.000Z",
    }),
  );
  const parsed = parseBackupJson(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  applyBackupImport(parsed.payload, (p) => getDefinition(p)?.kind);
  return "ds-1";
}

describe("备份恢复的服务：补填密钥后恢复可用", () => {
  it("needsCredentials -> services:update 填 key -> 标记清除 -> 刷新打到适配器并成功", async () => {
    const id = restoreDeepseekFromBackup();
    expect(getService(id)?.needsCredentials).toBe(true);

    // 补填前：刷新被拦下，不发请求
    await expect(refreshServiceInternal(id)).rejects.toThrow(NEEDS_CREDENTIALS_MESSAGE);
    expect(http.calls).toHaveLength(0);

    const updated = updateServiceFromInput(id, {
      name: "DeepSeek",
      provider: "deepseek",
      fields: { apiKey: "sk-test-123" },
    });
    expect(updated?.needsCredentials).toBeUndefined();
    expect(getService(id)?.needsCredentials).toBeUndefined();
    expect(getSecrets(id)).toEqual({ apiKey: "sk-test-123" });

    // 标记落盘：重启后也不会再被当成「需重新填写」
    flushDb();
    const disk = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")) as {
      services: { id: string; needsCredentials?: boolean }[];
    };
    expect(disk.services.find((s) => s.id === id)?.needsCredentials).toBeUndefined();

    // 补填后：刷新不再被跳过，真正带着新 key 请求了厂商接口
    const balance = await refreshServiceInternal(id);
    expect(balance).toMatchObject({ remaining: 12.34, currency: "CNY" });
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].auth).toBe("Bearer sk-test-123");
    expect(listServices()).toHaveLength(1);
  });

  it("没填 key 的编辑被校验拦下，标记保留，刷新仍被跳过", async () => {
    const id = restoreDeepseekFromBackup();
    expect(() =>
      updateServiceFromInput(id, {
        name: "DeepSeek 改名",
        provider: "deepseek",
        fields: { apiKey: "" },
      }),
    ).toThrow(/缺少必填字段/);
    expect(getService(id)).toMatchObject({ name: "DeepSeek", needsCredentials: true });
    await expect(refreshServiceInternal(id)).rejects.toThrow(NEEDS_CREDENTIALS_MESSAGE);
    expect(http.calls).toHaveLength(0);
  });

  it("编辑不存在的服务报错", () => {
    expect(() =>
      updateServiceFromInput("nope", { name: "x", provider: "deepseek", fields: { apiKey: "k" } }),
    ).toThrow("服务不存在");
  });
});

describe("新建服务：密钥先加密成功再落库", () => {
  it("系统加密不可用时整次新建失败，不留下没有密钥的孤儿服务", () => {
    crypto.available = false;
    expect(() =>
      createServiceFromInput({
        name: "DeepSeek",
        provider: "deepseek",
        fields: { apiKey: "sk-x" },
      }),
    ).toThrow("系统加密不可用");
    expect(listServices()).toEqual([]);
    // 落盘的数据里也没有
    flushDb();
    const disk = JSON.parse(fs.readFileSync(path.join(dir, "data.json"), "utf8")) as {
      services: unknown[];
      secrets: Record<string, unknown>;
    };
    expect(disk.services).toEqual([]);
    expect(disk.secrets).toEqual({});
  });

  it("加密可用时正常新建，密钥按服务定义存进 secrets 而不是 config", () => {
    const rec = createServiceFromInput({
      name: "DeepSeek",
      provider: "deepseek",
      fields: { apiKey: "sk-x" },
    });
    expect(listServices().map((s) => s.id)).toEqual([rec.id]);
    expect(rec.config).toEqual({});
    expect(getSecrets(rec.id)).toEqual({ apiKey: "sk-x" });
  });
});

describe("编辑服务：服务类型以库里的记录为准", () => {
  it("渲染进程传来别的 provider 时拒绝，记录与密钥都不变", () => {
    const rec = createServiceFromInput({
      name: "DeepSeek",
      provider: "deepseek",
      fields: { apiKey: "sk-old" },
    });
    expect(() =>
      updateServiceFromInput(rec.id, {
        name: "改名",
        provider: "openai",
        fields: { apiKey: "sk-new" },
      }),
    ).toThrow("不能修改服务类型");
    expect(getService(rec.id)).toMatchObject({ name: "DeepSeek", provider: "deepseek" });
    expect(getSecrets(rec.id)).toEqual({ apiKey: "sk-old" });
  });

  it("不传 provider 时按库里的类型校验并拆分字段：密钥仍进 secrets，不会落成明文 config", () => {
    const rec = createServiceFromInput({
      name: "DeepSeek",
      provider: "deepseek",
      fields: { apiKey: "sk-old" },
    });
    const updated = updateServiceFromInput(rec.id, {
      name: "DeepSeek 工作号",
      fields: { apiKey: "sk-new" },
    });
    expect(updated).toMatchObject({ name: "DeepSeek 工作号", provider: "deepseek", config: {} });
    expect(getSecrets(rec.id)).toEqual({ apiKey: "sk-new" });
  });

  it("编辑时加密失败：名称等元数据也不改（整次编辑不生效）", () => {
    const rec = createServiceFromInput({
      name: "DeepSeek",
      provider: "deepseek",
      fields: { apiKey: "sk-old" },
    });
    crypto.available = false;
    expect(() =>
      updateServiceFromInput(rec.id, {
        name: "改名",
        provider: "deepseek",
        fields: { apiKey: "sk-new" },
      }),
    ).toThrow("系统加密不可用");
    expect(getService(rec.id)?.name).toBe("DeepSeek");
  });
});
