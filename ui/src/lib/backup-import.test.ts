import { describe, expect, it } from "vitest";
import { formatBackupImportResult, formatBackupPreviewText } from "./backup-preview";

describe("formatBackupPreviewText", () => {
  it("带上导出日期和条数，说明不含密钥", () => {
    expect(
      formatBackupPreviewText({
        local: 3,
        usage: 8,
        services: 0,
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
      services: 0,
      exportedAt: "",
    });
    expect(text).not.toContain("导出于");
    expect(text).toContain("本地日桶 0 条");
  });
});
describe("formatBackupPreviewText：服务清单", () => {
  it("备份带服务时写出个数", () => {
    expect(formatBackupPreviewText({ local: 1, usage: 2, services: 3, exportedAt: "" })).toBe(
      "将合并导入本地日桶 1 条、API 用量 2 条、服务 3 个。不含密钥和代理。确定导入？",
    );
  });
});

describe("formatBackupImportResult", () => {
  it("恢复了服务时提醒去管理页填密钥，并报告跳过条数", () => {
    expect(
      formatBackupImportResult({
        local: 1,
        usage: 2,
        usageSkipped: 3,
        services: 2,
        servicesMatched: 0,
        servicesSkipped: 1,
      }),
    ).toBe(
      "已导入本地 1 条、API 用量 2 条；跳过重复或无对应服务的用量 3 条；恢复服务 2 个，请到管理页重新填写密钥；1 个服务类型不支持，未恢复",
    );
  });

  it("没有额外信息时只报条数", () => {
    expect(
      formatBackupImportResult({
        local: 0,
        usage: 0,
        usageSkipped: 0,
        services: 0,
        servicesMatched: 0,
        servicesSkipped: 0,
      }),
    ).toBe("已导入本地 0 条、API 用量 0 条");
  });
});
