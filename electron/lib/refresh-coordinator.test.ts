import { describe, expect, it } from "vitest";
import { createRefreshCoordinator } from "./refresh-coordinator";

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("createRefreshCoordinator", () => {
  it("同一服务的并发请求只打一次接口，后来者复用结果（手动刷新撞上定时刷新）", async () => {
    const calls: string[] = [];
    const d = deferred<number>();
    const c = createRefreshCoordinator(async (id) => (calls.push(id), d.promise));
    const scheduled = c.refresh("a");
    const manual = c.refresh("a");
    expect(manual).toBe(scheduled);
    d.resolve(42);
    expect(await manual).toBe(42);
    expect(calls).toEqual(["a"]);
    // 结束后再刷新会重新请求
    const again = c.refresh("a");
    await again;
    expect(calls).toEqual(["a", "a"]);
  });

  it("手动与定时共享同一个并发上限", async () => {
    let active = 0, peak = 0;
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const c = createRefreshCoordinator(async (id) => {
      active++; peak = Math.max(peak, active);
      const g = deferred<void>(); gates.set(id, g);
      await g.promise;
      active--;
      return id;
    }, 3);
    const scheduled = c.refreshMany(["a", "b", "c", "d"]);
    const manual = c.refreshMany(["c", "d", "e", "f"]);
    await tick();
    expect(active).toBe(3);
    // 逐个放行，任何时刻都不超过 3
    for (let i = 0; i < 10 && gates.size; i++) {
      for (const [id, g] of [...gates]) { gates.delete(id); g.resolve(); }
      await tick(); await tick();
    }
    const [s, m] = await Promise.all([scheduled, manual]);
    expect(peak).toBe(3);
    expect(s.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    expect(m.map((r) => (r as PromiseFulfilledResult<string>).value)).toEqual(["c", "d", "e", "f"]);
  });

  it("单个失败不影响其它，失败后名额归还、in-flight 清掉", async () => {
    const c = createRefreshCoordinator(async (id) => {
      if (id === "bad") throw new Error("boom");
      return id;
    }, 1);
    const results = await c.refreshMany(["bad", "ok1", "ok2"]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    expect(c.inflight).toEqual([]);
    await expect(c.refresh("ok3")).resolves.toBe("ok3");
  });

  it("复用在途请求的调用方拿到同一个失败", async () => {
    const d = deferred<number>();
    const c = createRefreshCoordinator(() => d.promise);
    const a = c.refresh("x"), b = c.refresh("x");
    d.reject(new Error("down"));
    await expect(a).rejects.toThrow("down");
    await expect(b).rejects.toThrow("down");
  });
});
