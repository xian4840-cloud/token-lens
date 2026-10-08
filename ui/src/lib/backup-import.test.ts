import { describe, expect, it } from "vitest";
import { formatBackupPreviewText } from "./backup-preview";

describe("formatBackupPreviewText", () => {
  it("带上导出日期和条数，说明不含密钥", () => {
    expect(
      formatBackupPreviewText({
        local: 3,
        usage: 8,
        exportedAt: "2026-09-12T10:00:00.000Z",
      }),
    ).toBe(
      "将合并导入本地日桶 3 条、API 用量 8 条（导出于 2026-09-12）。不含密钥和代理。确定导入？",
    );
  });

  it("没有合法日期就不写导出时间", () => {
    const text = formatBackupPreviewText({
      local: 0,
      usage: 0,
      exportedAt: "",
    });
    expect(text).not.toContain("导出于");
    expect(text).toContain("本地日桶 0 条");
  });
});