import { describe, expect, it } from "vitest";
import { createBusyLock, mapPool } from "./concurrency";

describe("mapPool", () => {
  it("空列表直接返回空", async () => {
    expect(await mapPool([], 3, async (x: number) => x)).toEqual([]);
  });

  it("限制并发，结果按原顺序", async () => {
    let live = 0;
    let maxLive = 0;
    const items = [1, 2, 3, 4, 5];
    const results = await mapPool(items, 2, async (n) => {
      live += 1;
      maxLive = Math.max(maxLive, live);
      await new Promise((r) => setTimeout(r, 15));
      live -= 1;
      if (n === 3) throw new Error("boom");
      return n * 10;
    });
    expect(maxLive).toBeLessThanOrEqual(2);
    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[2]?.status).toBe("rejected");
    expect(results[4]).toEqual({ status: "fulfilled", value: 50 });
  });
});

describe("createBusyLock", () => {
  it("上一轮没完时跳过", async () => {
    const lock = createBusyLock();
    let runs = 0;
    const first = lock.tryRun(async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "a";
    });
    const second = lock.tryRun(async () => {
      runs += 1;
      return "b";
    });
    expect(second).toBeNull();
    expect(await first).toBe("a");
    expect(runs).toBe(1);
  });
});
