import { describe, expect, it } from "vitest";
import {
  filterDisabledWatchTargets,
  inferSourceFromPath,
  isWatchableFile,
} from "./activity";

describe("inferSourceFromPath", () => {
  it("识别 Windows 风格的各家会话路径", () => {
    expect(
      inferSourceFromPath("C:\\Users\\a\\.claude\\projects\\foo\\x.jsonl"),
    ).toBe("claude-code");
    expect(
      inferSourceFromPath("C:\\Users\\a\\.codex\\sessions\\2026\\s.jsonl"),
    ).toBe("codex");
    expect(
      inferSourceFromPath("C:\\Users\\a\\.grok\\sessions\\w\\id\\updates.jsonl"),
    ).toBe("grok-build");
    expect(
      inferSourceFromPath(
        "C:\\Users\\a\\.gemini\\antigravity\\conversations\\a.db",
      ),
    ).toBe("antigravity");
    expect(
      inferSourceFromPath("C:\\Users\\a\\AppData\\Local\\opencode\\opencode.db"),
    ).toBe("opencode");
  });

  it("未知路径返回 undefined", () => {
    expect(inferSourceFromPath("C:\\Users\\a\\Documents\\notes.jsonl")).toBe(
      undefined,
    );
  });
});

describe("isWatchableFile", () => {
  it("认会话与库文件", () => {
    expect(isWatchableFile("updates.jsonl")).toBe(true);
    expect(isWatchableFile("session.json")).toBe(true);
    expect(isWatchableFile("opencode.db")).toBe(true);
    expect(isWatchableFile(null)).toBe(true);
  });

  it("丢掉编辑器临时文件", () => {
    expect(isWatchableFile("updates.jsonl.tmp")).toBe(false);
    expect(isWatchableFile("foo.swp")).toBe(false);
  });
});

describe("filterDisabledWatchTargets", () => {
  it("关掉的来源不再盯", () => {
    const targets = [
      { dir: "a", source: "codex" as const },
      { dir: "b", source: "claude-code" as const },
    ];
    expect(filterDisabledWatchTargets(targets, ["codex"]).map((t) => t.source)).toEqual([
      "claude-code",
    ]);
    expect(filterDisabledWatchTargets(targets, [])).toBe(targets);
  });
});
