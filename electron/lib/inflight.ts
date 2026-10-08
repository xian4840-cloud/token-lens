/**
 * 同一时刻只跑一份异步任务，后来者共用进行中的 Promise。
 * 调度器启动扫描与桌宠刷新会撞到同一批 jsonl，没有这层就会双倍打盘。
 */
export function singleFlight<T>(
  holder: { current: Promise<T> | null },
  run: () => Promise<T>,
): Promise<T> {
  if (holder.current) return holder.current;
  const p = Promise.resolve()
    .then(run)
    .finally(() => {
      if (holder.current === p) holder.current = null;
    });
  holder.current = p;
  return p;
}
