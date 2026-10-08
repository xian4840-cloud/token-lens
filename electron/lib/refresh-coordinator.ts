/**
 * 余额刷新的统一调度：手动刷新（单个 / 全部）与定时刷新走同一把锁、同一个并发上限。
 *
 * 此前两条路各管各的：调度器自己有 busy 锁 + 并发 3，渲染进程「全部刷新」则是
 * 每个服务一个 IPC 同时打出去、没有上限，两者还可能同时打同一家厂商的接口
 * （例如定时刷新正跑着，用户按了 F5）。现在：
 * - 同一个服务同一时刻只有一次在途请求，后来者直接复用它的结果；
 * - 所有服务的在途请求合计不超过 concurrency 个，手动与定时共享这个额度。
 */
export interface RefreshCoordinator<T> {
  /** 刷新一个服务；已有在途请求则复用 */
  refresh(id: string): Promise<T>;
  /** 刷新一组服务（受同一并发上限约束），结果按传入顺序对齐 */
  refreshMany(ids: readonly string[]): Promise<PromiseSettledResult<T>[]>;
  /** 当前在途（含排队）的服务 id，测试 / 诊断用 */
  readonly inflight: readonly string[];
}

export function createRefreshCoordinator<T>(
  run: (id: string) => Promise<T>,
  concurrency = 3,
): RefreshCoordinator<T> {
  const limit = Math.max(1, Math.floor(concurrency));
  const inflight = new Map<string, Promise<T>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    // 名额直接转交给下一个排队者，active 不变
    if (next) next();
    else active -= 1;
  };

  const refresh = (id: string): Promise<T> => {
    const existing = inflight.get(id);
    if (existing) return existing;
    const p = (async () => {
      await acquire();
      try {
        return await run(id);
      } finally {
        release();
      }
    })();
    inflight.set(id, p);
    const cleanup = () => {
      if (inflight.get(id) === p) inflight.delete(id);
    };
    p.then(cleanup, cleanup);
    return p;
  };

  return {
    refresh,
    refreshMany: (ids) => Promise.allSettled(ids.map((id) => refresh(id))),
    get inflight() {
      return [...inflight.keys()];
    },
  };
}
