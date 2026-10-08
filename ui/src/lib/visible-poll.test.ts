import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MONITOR_POLL_MS, startVisiblePoll, type VisibilitySource } from "./visible-poll";

function fakeDoc() {
  const listeners = new Set<() => void>();
  const doc = {
    hidden: false,
    addEventListener: (_: "visibilitychange", l: () => void) => listeners.add(l),
    removeEventListener: (_: "visibilitychange", l: () => void) => listeners.delete(l),
    set(hidden: boolean) {
      doc.hidden = hidden;
      for (const l of listeners) l();
    },
    listeners,
  };
  return doc as typeof doc & VisibilitySource;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startVisiblePoll", () => {
  it("间隔放宽到 10 秒（此前 3 秒）", () => {
    expect(MONITOR_POLL_MS).toBe(10_000);
  });

  it("立即加载一次，之后按间隔轮询", async () => {
    const load = vi.fn(async () => {});
    const stop = startVisiblePoll(load, { doc: fakeDoc() });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(4);
    stop();
  });

  it("页面隐藏时暂停，重新可见时立刻补一轮并恢复", async () => {
    const doc = fakeDoc();
    const load = vi.fn(async () => {});
    const stop = startVisiblePoll(load, { doc });
    await vi.advanceTimersByTimeAsync(0);
    doc.set(true);
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS * 10);
    expect(load).toHaveBeenCalledTimes(1);
    doc.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it("上一轮没跑完不叠加；load 抛错也不会让轮询停掉", async () => {
    const doc = fakeDoc();
    let release!: () => void;
    let calls = 0;
    const load = vi.fn(() => {
      calls++;
      if (calls === 1) return new Promise<void>((r) => (release = r));
      return Promise.reject(new Error("boom"));
    });
    const stop = startVisiblePoll(load, { doc });
    doc.set(true);
    doc.set(false); // 可见时触发补跑，但上一轮还在跑
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it("repeat=false 只跑一次；stop 后不再调度并移除监听", async () => {
    const doc = fakeDoc();
    const load = vi.fn(async () => {});
    const stopOnce = startVisiblePoll(load, { doc, repeat: false });
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
    stopOnce();

    const load2 = vi.fn(async () => {});
    const stop = startVisiblePoll(load2, { doc });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(MONITOR_POLL_MS * 3);
    expect(load2).toHaveBeenCalledTimes(1);
    expect(doc.listeners.size).toBe(0);
  });
});
