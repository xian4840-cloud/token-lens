import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 统一刷新调度 + 服务编辑 / 删除的竞态：
 * 刷新在途时用户改了密钥（或删了服务）再点刷新，不能复用旧密钥的在途请求，
 * 旧请求晚回来也不能把旧余额 / 旧报错写回成最新状态。
 *
 * 只桩掉 safeStorage 与 HTTP；db、适配器、service-update、refresh 调度都是真的。
 * HTTP 每次调用挂起，由测试决定先后顺序和返回值。
 */

vi.mock("./secrets", () => ({
  isEncryptionAvailable: () => true,
  encrypt: (text: string) => Buffer.from(`enc:${text}`, "utf8"),
  decrypt: (buf: Buffer) => buf.toString("utf8").replace(/^enc:/, ""),
}));

type Pending = {
  auth: string | undefined;
  respond: (balance: string) => void;
  fail: (status: number) => void;
};
const http = vi.hoisted(() => ({ calls: [] as Pending[] }));

vi.mock("./lib/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/http")>()),
  fetchWithTimeout: (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return new Promise((resolve) => {
      const reply = (status: number, body: unknown) =>
        resolve({
          ok: status === 200,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        });
      http.calls.push({
        auth: headers.Authorization ?? headers.authorization,
        respond: (balance) =>
          reply(200, {
            is_available: true,
            balance_infos: [
              {
                currency: "CNY",
                total_balance: balance,
                granted_balance: "0.00",
                topped_up_balance: balance,
              },
            ],
          }),
        fail: (status) => reply(status, { error: { message: "Authentication Fails" } }),
      });
    });
  },
}));

const {
  deleteServiceRow,
  flushDb,
  getLastBalances,
  importBackupServices,
  initDbAt,
  listBalanceSnapshots,
  onServiceChanged,
  saveBalanceSnapshot,
  saveLastBalance,
  setNeedsCredentials,
} = await import("./db");
const { registerAllAdapters } = await import("./adapters");
const { NEEDS_CREDENTIALS_MESSAGE } = await import("./lib/backup");
const { refreshService, refreshServices } = await import("./refresh");
const { createServiceFromInput, updateServiceFromInput } = await import("./service-update");

registerAllAdapters();

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-refresh-inv-"));
  initDbAt(path.join(dir, "data.json"));
  http.calls.length = 0;
});
afterEach(() => {
  flushDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const tick = () => new Promise<void>((r) => setImmediate(r));
async function waitCalls(n: number) {
  for (let i = 0; i < 50 && http.calls.length < n; i++) await tick();
  expect(http.calls).toHaveLength(n);
}

function createDeepseek(key: string): string {
  return createServiceFromInput({ name: "DeepSeek", provider: "deepseek", fields: { apiKey: key } })
    .id;
}
function changeKey(id: string, key: string) {
  updateServiceFromInput(id, { name: "DeepSeek", provider: "deepseek", fields: { apiKey: key } });
}

describe("刷新在途时修改服务配置", () => {
  it("改密钥后再刷新：发新请求用新密钥；旧请求晚回来不覆盖新结果", async () => {
    const id = createDeepseek("sk-old");
    const scheduled = refreshService(id); // 例如定时刷新正在跑
    await waitCalls(1);
    expect(http.calls[0].auth).toBe("Bearer sk-old");

    changeKey(id, "sk-new");
    const manual = refreshService(id);
    expect(manual).not.toBe(scheduled);
    await waitCalls(2);
    expect(http.calls[1].auth).toBe("Bearer sk-new");

    http.calls[1].respond("20.00");
    expect((await manual).remaining).toBe(20);
    http.calls[0].respond("10.00"); // 旧密钥的结果晚到
    // 旧请求的调用方拿到的也是新结果
    expect((await scheduled).remaining).toBe(20);

    expect(getLastBalances()[id]?.remaining).toBe(20);
    expect(listBalanceSnapshots(id).map((s) => s.balance)).toEqual([20]);
    expect(http.calls).toHaveLength(2);
  });

  it("旧请求先回来：不写回，调用方等新请求的结果", async () => {
    const id = createDeepseek("sk-old");
    const scheduled = refreshService(id);
    await waitCalls(1);
    changeKey(id, "sk-new");
    const manual = refreshService(id);
    await waitCalls(2);

    http.calls[0].respond("10.00");
    await tick();
    await tick();
    expect(getLastBalances()[id]).toBeUndefined();
    expect(listBalanceSnapshots(id)).toEqual([]);

    http.calls[1].respond("20.00");
    expect((await scheduled).remaining).toBe(20);
    expect((await manual).remaining).toBe(20);
    expect(listBalanceSnapshots(id).map((s) => s.balance)).toEqual([20]);
  });

  it("旧密钥的报错不会作为最新结果返回", async () => {
    const id = createDeepseek("sk-wrong");
    const scheduled = refreshServices([id]);
    await waitCalls(1);
    changeKey(id, "sk-right");
    const manual = refreshService(id);
    await waitCalls(2);
    http.calls[0].fail(401);
    http.calls[1].respond("5.00");
    const [r] = await scheduled;
    expect(r.status).toBe("fulfilled");
    expect((r as PromiseFulfilledResult<{ remaining?: number }>).value.remaining).toBe(5);
    expect((await manual).remaining).toBe(5);
  });

  it("没改配置时照旧复用在途请求（只打一次接口）", async () => {
    const id = createDeepseek("sk-1");
    const a = refreshService(id);
    const b = refreshService(id);
    expect(b).toBe(a);
    await waitCalls(1);
    http.calls[0].respond("1.00");
    expect((await b).remaining).toBe(1);
  });
});

describe("刷新在途时删除服务", () => {
  it("删除后旧请求回来不留孤儿快照 / lastBalance，调用方得到「服务不存在」", async () => {
    const id = createDeepseek("sk-old");
    const scheduled = refreshService(id);
    await waitCalls(1);
    deleteServiceRow(id);
    await expect(refreshService(id)).rejects.toThrow("服务不存在");
    http.calls[0].respond("10.00");
    await expect(scheduled).rejects.toThrow("服务不存在");
    expect(getLastBalances()[id]).toBeUndefined();
    expect(listBalanceSnapshots(id)).toEqual([]);
    expect(http.calls).toHaveLength(1);
  });
});

describe("服务变更通知覆盖所有改动入口", () => {
  it("新建 / 改密钥改配置 / 凭据标记 / 备份导入新建 / 删除都会通知；写余额不会", () => {
    const seen: string[] = [];
    const off = onServiceChanged((sid) => seen.push(sid));
    try {
      const id = createDeepseek("sk-1");
      expect(seen).toContain(id);
      seen.length = 0;
      changeKey(id, "sk-2");
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set([id]));
      seen.length = 0;
      setNeedsCredentials(id, true);
      expect(seen).toEqual([id]);
      seen.length = 0;
      saveBalanceSnapshot(id, 1, "CNY");
      saveLastBalance(id, {
        remaining: 1,
        currency: "CNY",
        fetchedAt: "2026-10-08T00:00:00.000Z",
      } as never);
      expect(seen).toEqual([]);
      importBackupServices(
        [
          {
            id: "restored-1",
            name: "Kimi",
            provider: "moonshot",
            createdAt: "2026-09-01T00:00:00.000Z",
          },
        ],
        () => "api",
      );
      expect(seen).toEqual(["restored-1"]);
      seen.length = 0;
      deleteServiceRow(id);
      expect(seen).toEqual([id]);
    } finally {
      off();
    }
  });

  it("备份导入新建的服务与一个已作废的在途请求同 id 时，不会复用旧请求", async () => {
    const id = createDeepseek("sk-old");
    const inflight = refreshService(id);
    await waitCalls(1);
    deleteServiceRow(id);
    importBackupServices(
      [{ id, name: "DeepSeek", provider: "deepseek", createdAt: "2026-09-01T00:00:00.000Z" }],
      () => "api",
    );
    http.calls[0].respond("10.00");
    // 恢复出来的服务需要重新填写密钥，刷新报这个而不是旧密钥的余额
    await expect(inflight).rejects.toThrow(NEEDS_CREDENTIALS_MESSAGE);
    expect(getLastBalances()[id]).toBeUndefined();
    expect(listBalanceSnapshots(id)).toEqual([]);
  });
});
