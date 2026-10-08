import { describe, expect, it } from "vitest";
import { applyLocalUsageCsv, applyPricingCsv, parseCsv, toCsv } from "./csv";
import type { PricingRowDisplay } from "@/types";

describe("toCsv", () => {
  it("空值写成空单元格，含 BOM", () => {
    const out = toCsv(
      ["a", "b"],
      [
        [1, null],
        [undefined, "x"],
      ],
    );
    expect(out.startsWith("\uFEFF")).toBe(true);
    expect(out.slice(1)).toBe("a,b\r\n1,\r\n,x");
  });

  it("含逗号或引号的字段加引号并转义", () => {
    const out = toCsv(["n"], [['say "hi", please']]);
    expect(out).toContain('"say ""hi"", please"');
  });
});

describe("parseCsv", () => {
  it("能 roundtrip toCsv，并吃掉 BOM", () => {
    const raw = toCsv(
      ["key", "label"],
      [
        ["gpt-5", "GPT-5"],
        ['say "hi", please', "x"],
      ],
    );
    const parsed = parseCsv(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      ["key", "label"],
      ["gpt-5", "GPT-5"],
      ['say "hi", please', "x"],
    ]);
  });

  it("引号未闭合就失败，不把半截当成功", () => {
    const parsed = parseCsv('a,b\n"oops,1');
    expect(parsed).toEqual({ ok: false, error: "CSV 引号未闭合" });
  });

  it("空文件失败", () => {
    expect(parseCsv("\uFEFF  \n")).toEqual({ ok: false, error: "文件为空" });
  });
});

function row(
  key: string,
  prices: Partial<
    Pick<PricingRowDisplay, "inputPerM" | "outputPerM" | "cacheReadPerM" | "cacheWritePerM">
  > = {},
): PricingRowDisplay {
  const inputPerM = prices.inputPerM ?? 1;
  const outputPerM = prices.outputPerM ?? 2;
  const cacheReadPerM = prices.cacheReadPerM ?? 0.1;
  const cacheWritePerM = prices.cacheWritePerM ?? 0.2;
  return {
    key,
    label: key,
    inputPerM,
    outputPerM,
    cacheReadPerM,
    cacheWritePerM,
    currency: "USD",
    overridden: false,
    defaults: { inputPerM: 1, outputPerM: 2, cacheReadPerM: 0.1, cacheWritePerM: 0.2 },
  };
}

describe("applyPricingCsv", () => {
  it("按 key 覆盖数字，空单元格保持原值，不把空白当成 $0", () => {
    const current = [row("gpt-5"), row("claude-4")];
    const csv = toCsv(
      ["key", "inputPerM", "outputPerM", "cacheReadPerM", "cacheWritePerM"],
      [["gpt-5", 3, "", "", ""]],
    );
    const out = applyPricingCsv(current, csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.applied).toBe(1);
    expect(out.rows[0]?.inputPerM).toBe(3);
    expect(out.rows[0]?.outputPerM).toBe(2);
    expect(out.rows[0]?.cacheReadPerM).toBe(0.1);
    expect(out.rows[0]?.overridden).toBe(true);
    expect(out.rows[1]).toEqual(current[1]);
  });

  it("不认识的 key 不新增成 $0 行", () => {
    const current = [row("gpt-5")];
    const csv = toCsv(
      ["key", "inputPerM", "outputPerM"],
      [
        ["gpt-5", 5, 6],
        ["totally-unknown-model", 0, 0],
      ],
    );
    const out = applyPricingCsv(current, csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.applied).toBe(1);
    expect(out.unknownKeys).toEqual(["totally-unknown-model"]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.inputPerM).toBe(5);
  });

  it("非法数字记进 invalid，不静默跳过", () => {
    const current = [row("gpt-5")];
    const csv = toCsv(
      ["key", "inputPerM"],
      [
        ["gpt-5", "abc"],
        ["gpt-5", -1],
      ],
    );
    const out = applyPricingCsv(current, csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.applied).toBe(0);
    expect(out.invalid.length).toBe(2);
    expect(out.rows[0]?.inputPerM).toBe(1);
  });

  it("缺 key 列或没有数据行直接失败", () => {
    expect(applyPricingCsv([row("gpt-5")], toCsv(["label"], [["x"]])).ok).toBe(false);
    expect(applyPricingCsv([row("gpt-5")], "key,inputPerM\n").ok).toBe(false);
  });
});

describe("applyLocalUsageCsv", () => {
  it("能 roundtrip 用量页导出的中文表头，空费用不当 $0", () => {
    const csv = toCsv(
      ["日期", "来源", "模型", "会话", "输入", "输出", "缓存写", "缓存读", "推理", "费用", "币种"],
      [
        ["2026-09-01", "codex", "gpt-5", 2, 10, 4, 1, 3, 0, "", "USD"],
        ["2026-09-01", "codex", "priced", 1, 5, 1, 0, 0, 0, 1.25, "USD"],
      ],
    );
    const out = applyLocalUsageCsv(csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]?.cost).toBeUndefined();
    expect(out.rows[1]?.cost).toBe(1.25);
    expect(out.rows[0]?.inputTokens).toBe(10);
  });

  it("未知来源不写入，非法数字记 invalid", () => {
    const csv = toCsv(
      ["日期", "来源", "模型", "输入"],
      [
        ["2026-09-01", "not-a-source", "m", 1],
        ["不是日期", "codex", "m", 1],
        ["2026-09-01", "codex", "m", -8],
      ],
    );
    const out = applyLocalUsageCsv(csv);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(0);
    expect(out.unknownSources).toEqual(["not-a-source"]);
    expect(out.invalid.length).toBe(2);
  });
});
