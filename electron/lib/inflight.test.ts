import { describe, expect, it } from "vitest";
import { singleFlight } from "./inflight";

describe("singleFlight", () => {
  it("进行中的调用被后来者复用，不会并行跑两份", async () => {
    let runs = 0;
    const holder: { current: Promise<number> | null } = { current: null };
    const run = () =>
      new Promise<number>((resolve) => {
        runs += 1;
        setTimeout(() => resolve(runs), 20);
      });

    const a = singleFlight(holder, run);
    const b = singleFlight(holder, run);
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(runs).toBe(1);
  });

  it("结束后下一次是新的调用", async () => {
    const holder: { current: Promise<number> | null } = { current: null };
    let n = 0;
    const run = async () => {
      n += 1;
      return n;
    };
    expect(await singleFlight(holder, run)).toBe(1);
    expect(await singleFlight(holder, run)).toBe(2);
  });
});
