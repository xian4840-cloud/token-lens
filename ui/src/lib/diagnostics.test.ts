import { describe, expect, it } from "vitest";
import { formatDiagnosticSummary } from "./diagnostics";

describe("formatDiagnosticSummary", () => {
  it("拼出统计、路径和最近日志，截到 limit", () => {
    const text = formatDiagnosticSummary({
      stats: {
        bytes: 2048,
        services: 2,
        usageRecords: 4,
        localDaily: 6,
        snapshots: 8,
      },
      logPath: "D:/data/app.log",
      logs: [
        { time: "t1", level: "error", scope: "db", message: "boom" },
        { time: "t2", level: "info", scope: "app", message: "later-line" },
      ],
      limit: 1,
    });
    expect(text).toContain("2.0 KB");
    expect(text).toContain("服务 2");
    expect(text).toContain("app.log");
    expect(text).toContain("boom");
    expect(text).not.toContain("later-line");
  });

  it("没有统计时仍能只输出日志", () => {
    expect(
      formatDiagnosticSummary({
        logs: [{ time: "t", level: "warn", scope: "x", message: "w" }],
      }),
    ).toBe("t [warn] [x] w");
  });
});