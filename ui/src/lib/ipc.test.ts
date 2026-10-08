import { afterEach, describe, expect, it, vi } from "vitest";
import { ipc } from "./ipc";

/** ipc.xxx 原样转给调用时的 window.tokenLens.xxx（方法与类型来自 shared/ipc.ts） */
describe("ipc 转发", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("调用时才取 window.tokenLens，参数与返回值原样传递", async () => {
    const listSnapshots = vi.fn(async () => [{ id: 1 }]);
    (globalThis as { window?: unknown }).window = { tokenLens: { listSnapshots } };
    await expect(ipc.listSnapshots("svc", "2026-10-01")).resolves.toEqual([{ id: 1 }]);
    expect(listSnapshots).toHaveBeenCalledWith("svc", "2026-10-01");

    // 换掉 window.tokenLens 后转发到新的实现
    const ping = vi.fn(async () => "pong");
    (globalThis as { window?: unknown }).window = { tokenLens: { ping } };
    await expect(ipc.ping()).resolves.toBe("pong");
  });
});
