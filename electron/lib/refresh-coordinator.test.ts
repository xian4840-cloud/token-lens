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
    let active = 0,
      peak = 0;
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const c = createRefreshCoordinator(async (id) => {
      active++;
      peak = Math.max(peak, active);
      const g = deferred<void>();
      gates.set(id, g);
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
      for (const [id, g] of [...gates]) {
        gates.delete(id);
        g.resolve();
      }
      await tick();
      await tick();
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
    const a = c.refresh("x"),
      b = c.refresh("x");
    d.reject(new Error("down"));
    await expect(a).rejects.toThrow("down");
    await expect(b).rejects.toThrow("down");
  });

  describe("invalidate：配置变了不复用、不交出旧结果", () => {
    it("作废后再刷新会发新请求；旧请求的调用方跟随新结果，旧结果晚到也不会交出去", async () => {
      const runs: {
        id: string;
        isCurrent: () => boolean;
        d: ReturnType<typeof deferred<string>>;
      }[] = [];
      const c = createRefreshCoordinator((id, isCurrent) => {
        const d = deferred<string>();
        runs.push({ id, isCurrent, d });
        return d.promise;
      });
      const old = c.refresh("a");
      await tick();
      c.invalidate("a");
      expect(c.inflight).toEqual([]);
      const fresh = c.refresh("a");
      expect(fresh).not.toBe(old);
      await tick();
      expect(runs).toHaveLength(2);
      expect(runs[0].isCurrent()).toBe(false);
      expect(runs[1].isCurrent()).toBe(true);
      // 新请求先完成，旧请求后到
      runs[1].d.resolve("new");
      expect(await fresh).toBe("new");
      runs[0].d.resolve("old");
      expect(await old).toBe("new");
      expect(runs).toHaveLength(2); // 跟随已结束的新请求，不再多发
    });

    it("作废后还没人刷新：旧请求结束时用新配置补发一次", async () => {
      const runs: ReturnType<typeof deferred<string>>[] = [];
      const c = createRefreshCoordinator(() => {
        const d = deferred<string>();
        runs.push(d);
        return d.promise;
      });
      const old = c.refresh("a");
      await tick();
      c.invalidate("a");
      runs[0].resolve("old");
      await tick();
      await tick();
      expect(runs).toHaveLength(2);
      runs[1].resolve("new");
      expect(await old).toBe("new");
    });

    it("旧请求先完成：调用方等到新请求的结果，不额外发请求", async () => {
      const runs: ReturnType<typeof deferred<string>>[] = [];
      const c = createRefreshCoordinator(() => {
        const d = deferred<string>();
        runs.push(d);
        return d.promise;
      });
      const old = c.refresh("a");
      await tick();
      c.invalidate("a");
      const fresh = c.refresh("a");
      await tick();
      runs[0].resolve("old");
      await tick();
      runs[1].resolve("new");
      expect(await old).toBe("new");
      expect(await fresh).toBe("new");
      expect(runs).toHaveLength(2);
    });

    it("旧请求的失败（旧密钥报错）不交给调用方", async () => {
      const runs: ReturnType<typeof deferred<string>>[] = [];
      const c = createRefreshCoordinator(() => {
        const d = deferred<string>();
        runs.push(d);
        return d.promise;
      });
      const old = c.refresh("a");
      await tick();
      c.invalidate("a");
      const fresh = c.refresh("a");
      await tick();
      runs[0].reject(new Error("401 旧密钥"));
      runs[1].resolve("ok");
      await expect(old).resolves.toBe("ok");
      await expect(fresh).resolves.toBe("ok");
    });

    it("还在排队的旧请求作废后不再执行，也不占名额", async () => {
      const started: string[] = [];
      const gate = deferred<void>();
      const c = createRefreshCoordinator(async (id) => {
        started.push(id);
        if (id === "busy") await gate.promise;
        return id;
      }, 1);
      const busy = c.refresh("busy");
      const queued = c.refresh("a");
      c.invalidate("a");
      gate.resolve();
      await busy;
      expect(await queued).toBe("a");
      expect(started).toEqual(["busy", "a"]); // 只执行了作废之后的那一次
    });

    it("只作废指定服务", async () => {
      const d = deferred<string>();
      const c = createRefreshCoordinator(() => d.promise);
      const a = c.refresh("a");
      const b = c.refresh("b");
      c.invalidate("b");
      expect(c.refresh("a")).toBe(a);
      expect(c.refresh("b")).not.toBe(b);
      d.resolve("x");
      await Promise.all([a, b]);
    });
  });
});
