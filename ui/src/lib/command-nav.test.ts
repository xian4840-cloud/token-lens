import { describe, expect, it } from "vitest";
import { clampIndex, stepIndex } from "./command-nav";

describe("stepIndex", () => {
  it("向下走到下一项，末尾绕回", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
  });

  it("向上走到上一项，开头绕到末尾", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(1, -1, 3)).toBe(0);
  });

  it("空列表停在 0，不出现 -1", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(stepIndex(4, -1, 0)).toBe(0);
  });
});

describe("clampIndex", () => {
  it("过滤变短时夹回最后一项", () => {
    expect(clampIndex(5, 2)).toBe(1);
    expect(clampIndex(0, 2)).toBe(0);
  });

  it("空列表或负数回到 0", () => {
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(-1, 4)).toBe(0);
  });
});
