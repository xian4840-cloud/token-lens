import { describe, expect, it } from "vitest";
import { formatCaptureRemoval } from "./capture-removal";

describe("formatCaptureRemoval", () => {
  it("Claude：提示重开终端", () => {
    expect(formatCaptureRemoval("claude-code", { removed: ["a", "b"], kept: [] })).toBe(
      "已关闭，清理了 2 项。已打开的终端还带着旧的环境变量，关闭后重新打开即可恢复原样。",
    );
  });
  it("OpenCode：提示重开 OpenCode", () => {
    expect(formatCaptureRemoval("opencode", { removed: ["a"], kept: [] })).toContain("重新打开 OpenCode");
  });
  it("没有可清理项、以及保留的非本应用文件都要说清楚", () => {
    const text = formatCaptureRemoval("opencode", { removed: [], kept: ["/x/plugin.js"] });
    expect(text).toContain("没有找到需要清理的采集文件");
    expect(text).toContain("已保留：/x/plugin.js");
  });
});
