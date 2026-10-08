import { describe, expect, it } from "vitest";
import { applySearchEscape } from "./search-escape";

describe("applySearchEscape", () => {
  it("Esc 且有内容时清空并拦截默认行为", () => {
    let cleared = false;
    let prevented = false;
    const used = applySearchEscape(
      { key: "Escape", preventDefault: () => { prevented = true; } },
      "foo",
      () => { cleared = true; },
    );
    expect(used).toBe(true);
    expect(cleared).toBe(true);
    expect(prevented).toBe(true);
  });

  it("空内容的 Esc 不拦截，好让对话框能关", () => {
    let cleared = false;
    const used = applySearchEscape(
      { key: "Escape", preventDefault: () => { /* noop */ } },
      "",
      () => { cleared = true; },
    );
    expect(used).toBe(false);
    expect(cleared).toBe(false);
  });

  it("其他键不动", () => {
    let cleared = false;
    expect(
      applySearchEscape(
        { key: "Enter", preventDefault: () => { /* noop */ } },
        "foo",
        () => { cleared = true; },
      ),
    ).toBe(false);
    expect(cleared).toBe(false);
  });
});