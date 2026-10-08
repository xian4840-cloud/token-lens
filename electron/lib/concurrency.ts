/**
 * 有限并发地跑一组任务，结果按下标对齐（和 Promise.allSettled 同形）。
 * 调度器刷新余额用这个，避免一家超时把后面所有卡冻住。
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** 上一轮没结束就跳过，禁止 setInterval 叠两轮打厂商 API。 */
export function createBusyLock(): {
  tryRun: <T>(fn: () => Promise<T>) => Promise<T> | null;
  readonly busy: boolean;
} {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    tryRun<T>(fn: () => Promise<T>): Promise<T> | null {
      if (busy) return null;
      busy = true;
      return fn().finally(() => {
        busy = false;
      });
    },
  };
}
