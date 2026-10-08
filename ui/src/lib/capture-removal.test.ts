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
  it("BUN_OPTIONS 仍引用采集脚本时：说明脚本被刻意保留，而不是说「不是 Token Lens 创建的」", () => {
    const reason = "HKCU\\Environment\\BUN_OPTIONS：剩余的值仍引用 token-lens-monitor/claude.cjs（写法无法自动识别），请手动删除该项";
    const text = formatCaptureRemoval("claude-code", { removed: [], kept: [reason, "C:/x/claude.cjs（…）"] });
    expect(text).toContain("采集脚本已保留");
    expect(text).toContain(reason);
    expect(text).toContain("手动清理 BUN_OPTIONS");
    expect(text).not.toContain("不是 Token Lens 创建的");
    expect(text).not.toContain("没有找到需要清理的采集文件");
    expect(formatCaptureRemoval("claude-code", { removed: [], kept: ["BUN_OPTIONS（当前进程环境）：…"] })).toContain("采集脚本已保留");
  });
});
