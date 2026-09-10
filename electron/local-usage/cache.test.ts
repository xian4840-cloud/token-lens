import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 扫描缓存的读写与失效。
 *
 * 这是本项目第一次给 cache.ts 写测试。它的正确性直接决定界面上的用量数字：
 * 缓存命中时扫描器会整文件复用聚合结果，不会再读一遍会话文件。
 */

const mocks = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
}));

const {
  getScanCache,
  persistScanCache,
  resetScanCache,
  isCodexEntryValid,
  isClaudeEntryValid,
  isAntigravityEntryValid,
  isGrokEntryValid,
} = await import("./cache");

const { clearUsageScanCache } = await import("./clear-cache");

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-lens-cache-"));
  mocks.userData = dir;
  resetScanCache();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function cachePath(): string {
  return path.join(dir, "usage-scan-cache.json");
}

function writeCacheFile(content: unknown): void {
  fs.writeFileSync(cachePath(), JSON.stringify(content), "utf8");
}

describe("getScanCache", () => {
  it("首次调用读盘，之后返回内存中的同一份引用", () => {
    writeCacheFile({ version: 2, claude: {}, codex: { "/a.jsonl": entry(1) } });

    const first = getScanCache();
    expect(first.codex["/a.jsonl"]).toBeDefined();
    // 同一引用：既是性能设计，也是下面那条回归的成因
    expect(getScanCache()).toBe(first);
  });

  it("缓存文件版本不符时退回空缓存", () => {
    writeCacheFile({ version: 1, claude: {}, codex: { "/a.jsonl": entry(1) } });
    expect(getScanCache().codex).toEqual({});
  });

  it("缓存文件损坏时退回空缓存而不是抛异常", () => {
    fs.writeFileSync(cachePath(), "{ 不是 JSON", "utf8");
    expect(getScanCache().codex).toEqual({});
  });

  it("缓存文件不存在时返回空缓存", () => {
    expect(getScanCache().codex).toEqual({});
  });
});

describe("resetScanCache", () => {
  it("丢弃内存缓存，下次调用重新读盘（回归）", () => {
    // 这条钉的是「清除用量缓存」按钮的有效性：缓存常驻内存，
    // 只删文件不清内存的话，本次会话内扫描照旧命中旧聚合，
    // 把所有会话文件按旧口径算出的数字原样写回，按钮要重启才生效。
    writeCacheFile({ version: 2, claude: {}, codex: { "/old.jsonl": entry(1) } });
    const before = getScanCache();
    expect(before.codex["/old.jsonl"]).toBeDefined();

    resetScanCache();

    const after = getScanCache();
    expect(after).not.toBe(before);
    // 内容也重新来自磁盘，而不是沿用上一份内存对象
    expect(after.codex["/old.jsonl"]).toBeDefined();
  });

  it("清掉内存后，删掉文件再取就是空的（模拟清除缓存的两步顺序）", () => {
    writeCacheFile({ version: 2, claude: {}, codex: { "/old.jsonl": entry(1) } });
    getScanCache(); // 填充内存

    resetScanCache();
    fs.unlinkSync(cachePath());

    expect(getScanCache().codex).toEqual({});
  });
});

describe("persistScanCache", () => {
  it("把内存缓存写盘并可被下一次读取还原", () => {
    const cache = getScanCache();
    cache.codex["/b.jsonl"] = entry(42);
    persistScanCache();

    resetScanCache();
    expect(getScanCache().codex["/b.jsonl"].mtimeMs).toBe(42);
  });

  it("条目超过上限时按 mtime 淘汰最旧的", () => {
    const cache = getScanCache();
    for (let i = 0; i < 4005; i++) {
      cache.codex[`/f${i}.jsonl`] = entry(i);
    }
    persistScanCache();

    const kept = Object.keys(cache.codex);
    expect(kept).toHaveLength(4000);
    // 留下的应该是 mtime 最大的那批
    expect(kept).toContain("/f4004.jsonl");
    expect(kept).not.toContain("/f0.jsonl");
  });
});

describe("clearUsageScanCache（设置页「清除用量缓存」按钮走的就是它）", () => {
  it("清完之后内存缓存不再服务旧内容（回归）", () => {
    // 旧实现只删文件、不清内存，于是 getScanCache 照旧返回那份常驻对象，
    // 紧跟着的重扫把所有会话文件按旧口径算出的聚合原样写回：用户看到
    // 「缓存清除成功，已重新扫描用量数据」，数字一个没变，要重启才生效。
    writeCacheFile({ version: 2, claude: {}, codex: { "/old.jsonl": entry(1) } });
    expect(getScanCache().codex["/old.jsonl"]).toBeDefined();

    clearUsageScanCache();

    expect(getScanCache().codex).toEqual({});
  });

  it("缓存文件也被删掉", () => {
    writeCacheFile({ version: 2, claude: {}, codex: {} });
    clearUsageScanCache();
    expect(fs.existsSync(cachePath())).toBe(false);
  });

  it("文件本就不存在时不报错", () => {
    expect(() => clearUsageScanCache()).not.toThrow();
  });
});

describe("缓存条目的结构守卫", () => {
  it("Codex 只认增量结构（v===2 且 increments 是数组）", () => {
    expect(isCodexEntryValid(entry(1) as never)).toBe(true);
    expect(isCodexEntryValid({ mtimeMs: 1, increments: [] } as never)).toBe(false);
    expect(isCodexEntryValid({ mtimeMs: 1, v: 1, increments: [] } as never)).toBe(
      false,
    );
    expect(isCodexEntryValid({ mtimeMs: 1, v: 2 } as never)).toBe(false);
  });

  it("Claude 认 per-model-per-day 结构，旧的单层聚合视为未命中", () => {
    expect(
      isClaudeEntryValid({ mtimeMs: 1, models: { m: { "2026-09-01": { input: 1 } } } } as never),
    ).toBe(true);
    // 旧版：models[model] 直接是聚合对象，其属性值是 number
    expect(
      isClaudeEntryValid({ mtimeMs: 1, models: { m: { input: 1 } } } as never),
    ).toBe(false);
    expect(isClaudeEntryValid({ mtimeMs: 1, models: {} } as never)).toBe(true);
  });

  it("Antigravity / Grok 认 per-model-per-day 结构", () => {
    const good = { mtimeMs: 1, models: { m: { "2026-09-01": { input: 1 } } } };
    expect(isAntigravityEntryValid(good as never)).toBe(true);
    expect(isGrokEntryValid(good as never)).toBe(true);
    expect(isAntigravityEntryValid({ mtimeMs: 1, models: { m: { x: 1 } } } as never)).toBe(
      false,
    );
    expect(isGrokEntryValid({ mtimeMs: 1, models: { m: { x: 1 } } } as never)).toBe(false);
  });
});

function entry(mtimeMs: number) {
  return { mtimeMs, v: 2 as const, increments: [] };
}
