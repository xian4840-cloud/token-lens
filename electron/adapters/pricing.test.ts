import { describe, expect, it } from "vitest";
import {
  computeCost,
  getPricingTable,
  parseOverrides,
  pruneDefaultOverrides,
  type ModelPricing,
} from "./pricing";
import { DEFAULT_PRICING } from "./pricing-table";
import { getRecentLogs } from "../lib/logger";

/**
 * 价格覆盖（设置页「模型价格表」）。
 *
 * 设置页展示的是「内置 + 覆盖」合并后的有效值，保存时又把整张表回传，
 * 于是它无法区分哪几行是用户真改过的。这里锁的就是这件事：
 * 回传整表之后，存下来的必须只剩真正有差异的行。
 */

/** 模拟设置页：取合并后的有效表，把某一行的输入价改掉，然后整表回传 */
function saveFromUi(editKey: string, delta: number): Record<string, Partial<ModelPricing>> {
  const rows = getPricingTable();
  const sent: Record<string, Partial<ModelPricing>> = {};
  for (const r of rows) {
    const inputPerM = r.key === editKey ? r.inputPerM + delta : r.inputPerM;
    sent[r.key] = {
      inputPerM,
      outputPerM: r.outputPerM,
      cacheReadPerM: r.cacheReadPerM,
      cacheWritePerM: r.cacheWritePerM,
    };
  }
  return sent;
}

describe("pruneDefaultOverrides", () => {
  it("设置页整表回传后，只剩真正改过的那一行（回归）", () => {
    const sent = saveFromUi("gpt-5", 1);

    // 先确认场景为真：旧行为收到的确实是整张表，不是一行
    expect(Object.keys(sent).length).toBeGreaterThan(50);

    const pruned = pruneDefaultOverrides(sent);
    expect(Object.keys(pruned)).toEqual(["gpt-5"]);
    expect(pruned["gpt-5"].inputPerM).toBe(
      (DEFAULT_PRICING.find((r) => r.key === "gpt-5")?.inputPerM ?? 0) + 1,
    );
  });

  it("未改动的行不再钉死内置值——这正是清理的意义", () => {
    const overrides = pruneDefaultOverrides(saveFromUi("gpt-5", 1));

    // 没被覆盖的行，费用仍按内置表算，日后版本更新价表即可生效
    const row = DEFAULT_PRICING.find((r) => r.key === "claude-sonnet-5")!;
    const c = computeCost("claude-sonnet-5", { input: 1_000_000 }, overrides);
    expect(c?.cost).toBeCloseTo(row.inputPerM, 6);
  });

  it("改过的行保留覆盖", () => {
    const overrides = pruneDefaultOverrides(saveFromUi("gpt-5", 1));
    const row = DEFAULT_PRICING.find((r) => r.key === "gpt-5")!;
    const c = computeCost("gpt-5", { input: 1_000_000 }, overrides);
    expect(c?.cost).toBeCloseTo(row.inputPerM + 1, 6);
  });

  it("只把缓存价改掉也算改动，不能当成默认值剔掉", () => {
    const row = DEFAULT_PRICING.find((r) => r.key === "claude-sonnet-5")!;
    const pruned = pruneDefaultOverrides({
      "claude-sonnet-5": { cacheReadPerM: (row.cacheReadPerM ?? 0) + 0.5 },
    });
    expect(Object.keys(pruned)).toEqual(["claude-sonnet-5"]);
  });

  it("部分字段的覆盖按「有效值」比较，缺省字段不算差异", () => {
    const row = DEFAULT_PRICING.find((r) => r.key === "gpt-5")!;
    // 只给 inputPerM 且等于内置值 -> 整项冗余
    expect(pruneDefaultOverrides({ "gpt-5": { inputPerM: row.inputPerM } })).toEqual({});
    // 只给 outputPerM 且等于内置值 -> 同样冗余
    expect(pruneDefaultOverrides({ "gpt-5": { outputPerM: row.outputPerM } })).toEqual({});
  });

  it("内置表里查不到的 key 原样保留（旧版本遗留）", () => {
    const legacy = { "removed-model-key": { inputPerM: 3 } };
    expect(pruneDefaultOverrides(legacy)).toEqual(legacy);
  });

  it("空对象与全默认表都返回空", () => {
    expect(pruneDefaultOverrides({})).toEqual({});
    const allDefault: Record<string, Partial<ModelPricing>> = {};
    for (const r of DEFAULT_PRICING) {
      allDefault[r.key] = {
        inputPerM: r.inputPerM,
        outputPerM: r.outputPerM,
        cacheReadPerM: r.cacheReadPerM ?? 0,
        cacheWritePerM: r.cacheWritePerM ?? 0,
      };
    }
    expect(pruneDefaultOverrides(allDefault)).toEqual({});
  });
});

describe("parseOverrides", () => {
  it("读取时顺带清理，存量数据能自愈", () => {
    // 老版本（或本轮修复前的设置页）存下来的整表覆盖
    const stored = JSON.stringify(saveFromUi("gpt-5", 1));
    expect(Object.keys(parseOverrides(stored))).toEqual(["gpt-5"]);
  });

  it("损坏的 JSON 回退为空而不是抛异常，并记一条警告", () => {
    expect(parseOverrides("{ 不是 JSON")).toEqual({});
    expect(
      getRecentLogs().some((e) => e.scope === "pricing" && e.message.includes("不是合法 JSON")),
    ).toBe(true);
    expect(parseOverrides(undefined)).toEqual({});
    expect(parseOverrides("")).toEqual({});
  });

  it("读取时按写入口的规则清洗：负价丢弃、0 保留，未知字段与非数值丢弃（回归）", () => {
    // 旧版本没有负数校验时存下来的、备份导入或手工改数据文件写进去的
    const stored = JSON.stringify({
      "gpt-5": { inputPerM: -1.25, outputPerM: 0, cacheReadPerM: "0.1", evil: 9 },
      "made-up-model": { inputPerM: -3, outputPerM: -4 },
      "legacy-free": { inputPerM: 0, outputPerM: 0 },
    });
    expect(parseOverrides(stored)).toEqual({
      "gpt-5": { outputPerM: 0 },
      "legacy-free": { inputPerM: 0, outputPerM: 0 },
    });
  });

  it("存量负价不会再让费用估算变成负数：负的那一项回落到内置价", () => {
    const overrides = parseOverrides(JSON.stringify({ "gpt-5": { inputPerM: -100 } }));
    const r = computeCost("gpt-5", { input: 1_000_000 }, overrides);
    expect(r?.cost).toBe(1.25);
    const row = getPricingTable(overrides).find((x) => x.key === "gpt-5");
    expect(row?.inputPerM).toBe(1.25);
  });

  it("非对象（数组、字符串、数字）不作为覆盖使用", () => {
    expect(parseOverrides("[1,2,3]")).toEqual({});
    expect(parseOverrides('[{"inputPerM":1}]')).toEqual({});
    expect(parseOverrides('"字符串"')).toEqual({});
    expect(parseOverrides("42")).toEqual({});
  });
});
