/**
 * 余额刷新的统一调度：手动刷新（单个 / 全部）与定时刷新走同一把锁、同一个并发上限。
 *
 * 此前两条路各管各的：调度器自己有 busy 锁 + 并发 3，渲染进程「全部刷新」则是
 * 每个服务一个 IPC 同时打出去、没有上限，两者还可能同时打同一家厂商的接口
 * （例如定时刷新正跑着，用户按了 F5）。现在：
 * - 同一个服务同一时刻只有一次在途请求，后来者直接复用它的结果；
 * - 所有服务的在途请求合计不超过 concurrency 个，手动与定时共享这个额度。
 *
 * 复用在途请求有一个前提：它用的还是当前的配置。用户改了密钥 / 配置或删了服务后，
 * 调用方应 invalidate(id)：
 * - 在途条目立刻摘掉，之后的 refresh 一定发起新请求、读新配置；
 * - 每个服务有一个代号（generation），invalidate 时加一。旧请求通过 isCurrent()
 *   得知自己已过期，run 应据此跳过写回（见 refresh.ts）；还在排队的旧请求直接不执行；
 * - 已拿着旧 Promise 的调用方不会收到旧结果：旧请求结束后改为跟随作废之后的那次刷新
 *   （不论它是否已结束；还没有就新发一次），服务已删除则得到新请求的报错。
 */
export interface RefreshCoordinator<T> {
  /** 刷新一个服务；已有在途请求则复用 */
  refresh(id: string): Promise<T>;
  /** 刷新一组服务（受同一并发上限约束），结果按传入顺序对齐 */
  refreshMany(ids: readonly string[]): Promise<PromiseSettledResult<T>[]>;
  /** 服务配置变了（改密钥 / 改配置 / 删除）：作废在途请求，见文件头说明 */
  invalidate(id: string): void;
  /** 当前在途（含排队）的服务 id，测试 / 诊断用 */
  readonly inflight: readonly string[];
}

export function createRefreshCoordinator<T>(
  /** isCurrent()：本次请求是否仍对应当前配置；返回 false 时不得把结果写回 */
  run: (id: string, isCurrent: () => boolean) => Promise<T>,
  concurrency = 3,
): RefreshCoordinator<T> {
  const limit = Math.max(1, Math.floor(concurrency));
  const inflight = new Map<string, Promise<T>>();
  const generation = new Map<string, number>();
  const genOf = (id: string) => generation.get(id) ?? 0;
  /** 每个服务最近一次发起的请求（含已结束的），供作废请求的调用方跟随 */
  const latest = new Map<string, { gen: number; p: Promise<T> }>();
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
    const gen = genOf(id);
    const isCurrent = () => genOf(id) === gen;
    const attempt = async (): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
      await acquire();
      try {
        // 排队期间已作废：不再发请求
        if (!isCurrent()) return { ok: false, error: undefined };
        return { ok: true, value: await run(id, isCurrent) };
      } catch (error) {
        return { ok: false, error };
      } finally {
        release();
      }
    };
    const p = (async () => {
      const r = await attempt();
      // 已作废：结果（成功或失败）都不交给调用方，改为跟随当前的刷新。
      // 放在 release 之后，避免占着名额等新请求。
      if (!isCurrent()) {
        // 作废之后已经有人用新配置刷过（不论是否结束）就用那次的结果，否则新发一次
        const l = latest.get(id);
        return l && l.gen === genOf(id) ? l.p : refresh(id);
      }
      if (r.ok) return r.value;
      throw r.error;
    })();
    inflight.set(id, p);
    latest.set(id, { gen, p });
    const cleanup = () => {
      if (inflight.get(id) === p) inflight.delete(id);
    };
    p.then(cleanup, cleanup);
    return p;
  };

  return {
    refresh,
    refreshMany: (ids) => Promise.allSettled(ids.map((id) => refresh(id))),
    invalidate(id) {
      generation.set(id, genOf(id) + 1);
      inflight.delete(id);
    },
    get inflight() {
      return [...inflight.keys()];
    },
  };
}
