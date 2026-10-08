import { describe, expect, it } from "vitest";
import {
  isEnvelopeOk,
  pickNumber,
  resolveZhipuBase,
  resolveZhipuRegion,
  type ZhipuEnvelope,
} from "./zhipu-common";
import {
  classifyPackageUnit,
  parseAccountReport,
  parseCustomerBalance,
  parseTokenAccounts,
  pickZhipuWallet,
} from "./zhipu";
import { measureLimit, parseQuotaLimits, planLevelLabel } from "./zhipu_plan";

describe("resolveZhipuBase", () => {
  it("默认国内站", () => {
    expect(resolveZhipuBase({})).toBe("https://open.bigmodel.cn");
    expect(resolveZhipuBase({ region: "cn" })).toBe("https://open.bigmodel.cn");
    expect(resolveZhipuRegion({})).toBe("cn");
  });

  it("国际站别名都指向 api.z.ai", () => {
    for (const region of ["global", "intl", "zai", "z.ai", "GLOBAL"]) {
      expect(resolveZhipuBase({ region })).toBe("https://api.z.ai");
    }
    expect(resolveZhipuRegion({ region: "global" })).toBe("global");
  });
});

describe("isEnvelopeOk", () => {
  it("HTTP 失败一律不算成功", () => {
    expect(isEnvelopeOk(false, { code: 200, success: true })).toBe(false);
  });

  it("HTTP 200 但 body.code=401 是鉴权失败（智谱业务接口的真实形态）", () => {
    expect(isEnvelopeOk(true, { code: 401, success: false, msg: "token expired" })).toBe(false);
    expect(isEnvelopeOk(true, { code: 401, msg: "unauthorized" })).toBe(false);
  });

  it("code 200 / 0 / 缺省且 success 非 false 视为成功", () => {
    expect(isEnvelopeOk(true, { code: 200, success: true })).toBe(true);
    expect(isEnvelopeOk(true, { code: 0, data: {} })).toBe(true);
    expect(isEnvelopeOk(true, { data: { limits: [] } })).toBe(true);
  });

  it("success:false 即使 code 看起来正常也失败", () => {
    expect(isEnvelopeOk(true, { code: 200, success: false })).toBe(false);
  });
});

describe("pickNumber", () => {
  it("按优先级取首个有限数字，兼容字符串和千分位", () => {
    expect(pickNumber({ a: "1,234.5", b: 9 }, ["b", "a"])).toBe(9);
    expect(pickNumber({ a: "1,234.5" }, ["a"])).toBe(1234.5);
    expect(pickNumber({ a: "x" }, ["a"])).toBeUndefined();
    expect(pickNumber(undefined, ["a"])).toBeUndefined();
  });

  it("0 是有效值", () => {
    expect(pickNumber({ a: 0 }, ["a"])).toBe(0);
    expect(pickNumber({ a: "0.00" }, ["a"])).toBe(0);
  });
});

describe("parseCustomerBalance", () => {
  it("拆出现金、赠金、可用总额", () => {
    expect(
      parseCustomerBalance({
        cashBalance: 80,
        voucherBalance: 18,
        availableBalance: 98,
      }),
    ).toEqual({ available: 98, cash: 80, voucher: 18 });
  });

  it("只有分项时自行加总 available", () => {
    expect(parseCustomerBalance({ cashBalance: "10", giftBalance: "8" })).toEqual({
      available: 18,
      cash: 10,
      voucher: 8,
    });
  });

  it("数字本身当作可用余额", () => {
    expect(parseCustomerBalance(12.5)).toEqual({ available: 12.5 });
    expect(parseCustomerBalance("3.2")).toEqual({ available: 3.2 });
  });

  it("嵌套 account / wallet 也能取到", () => {
    expect(parseCustomerBalance({ account: { balance: "7" } })).toEqual({
      available: 7,
    });
    expect(parseCustomerBalance({ wallet: { rechargeBalance: 10, giftBalance: 2 } })).toEqual({
      available: 12,
      cash: 10,
      voucher: 2,
    });
  });

  it("认识充值/赠金字段别名", () => {
    expect(parseCustomerBalance({ rechargeAmount: "9.9", bonusAmount: "1.1" })).toEqual({
      available: 11,
      cash: 9.9,
      voucher: 1.1,
    });
  });

  it("空对象返回空，不把 NaN 塞回去", () => {
    expect(parseCustomerBalance({})).toEqual({});
    expect(parseCustomerBalance(null)).toEqual({});
  });
});

describe("parseTokenAccounts", () => {
  it("读 rows 里的 availableBalance，按套餐名归组", () => {
    const env: ZhipuEnvelope = {
      code: 200,
      rows: [
        { resourcePackageName: "通用", availableBalance: 18.5, tokenNo: "bundle_502" },
        { suitableModel: "GLM-4.7", tokenBalance: "100", tokenNo: "bundle_x" },
      ],
    };
    expect(parseTokenAccounts(env)).toEqual([
      { label: "通用", remaining: 18.5, unit: "CNY" },
      { label: "GLM-4.7", remaining: 100, unit: "CNY" },
    ]);
  });

  it("兼容 data.rows / data.list", () => {
    expect(
      parseTokenAccounts({
        data: { list: [{ name: "搜索", remainAmount: 3 }] },
      }),
    ).toEqual([{ label: "搜索", remaining: 3, unit: "CNY" }]);
  });

  it("没有余额字段的行跳过，空响应得到空数组", () => {
    expect(parseTokenAccounts({ rows: [{ name: "空" }] })).toEqual([]);
    expect(parseTokenAccounts({})).toEqual([]);
  });
});

describe("classifyPackageUnit", () => {
  it("体验包 / 次数包不是人民币", () => {
    expect(classifyPackageUnit("【实名认证】500万GLM-4.7体验包", 5_000_000)).toBe("tokens");
    expect(classifyPackageUnit("【新用户专享】600万GLM-4.6资源包", 6_000_000)).toBe("tokens");
    expect(classifyPackageUnit("【新用户专享】20次图片/视频生成资源包", 20)).toBe("次");
    expect(classifyPackageUnit("【新用户专享】100次搜索资源包", 100)).toBe("次");
  });

  it("通用余额才是人民币", () => {
    expect(classifyPackageUnit("通用", 18.5)).toBe("CNY");
    expect(classifyPackageUnit("bundle_502", 12)).toBe("CNY");
  });
});

describe("pickZhipuWallet", () => {
  it("主数字只用现金/赠金，绝不把体验包 token 数加进人民币", () => {
    expect(pickZhipuWallet(12.5, 23_000_120, true)).toBe(12.5);
    expect(pickZhipuWallet(0, 23_000_120, true)).toBe(0);
    expect(pickZhipuWallet(undefined, 18.5, true)).toBe(18.5);
    expect(pickZhipuWallet(undefined, 0, false)).toBeUndefined();
  });
});

describe("parseAccountReport", () => {
  it("取 availableBalance，不把累计充值/赠金当成剩余", () => {
    expect(
      parseAccountReport({
        balance: 8.885165405,
        rechargeAmount: 60,
        giveAmount: 9.054011,
        totalSpendAmount: 60.168845595,
        availableBalance: 8.885165405,
        frozenBalance: 0,
      }),
    ).toEqual({ available: 8.885165405 });
  });
});

describe("parseTokenAccounts 体验包回归", () => {
  it("用户截图里的五条体验包都标成 tokens/次，不能当 CNY", () => {
    const env: ZhipuEnvelope = {
      rows: [
        {
          resourcePackageName: "【实名认证】500万GLM-4.7体验包",
          availableBalance: 5_000_000,
          consumeType: "TOKENS",
          status: "EFFECTIVE",
        },
        {
          resourcePackageName: "【新用户专享】20次图片/视频生成资源包",
          availableBalance: 20,
          consumeType: "TIMES",
          status: "EFFECTIVE",
        },
        {
          resourcePackageName: "【新用户专享】100次搜索资源包",
          availableBalance: 100,
          consumeType: "TIMES",
          status: "EFFECTIVE",
        },
        {
          resourcePackageName: "【新用户专享】600万GLM-4.6资源包",
          availableBalance: 6_000_000,
          consumeType: "TOKENS",
          status: "EFFECTIVE",
        },
        {
          resourcePackageName: "【新用户专享】1200万GLM-4.5-Air资源包",
          availableBalance: 12_000_000,
          consumeType: "TOKENS",
          status: "EFFECTIVE",
        },
        {
          resourcePackageName: "【新用户专享】200万通用模型推理资源包",
          availableBalance: 0,
          consumeType: "TOKENS",
          status: "EXPIRED",
        },
      ],
    };
    const rows = parseTokenAccounts(env);
    expect(rows.map((r) => r.unit)).toEqual(["tokens", "次", "次", "tokens", "tokens"]);
    const cnySum = rows.filter((r) => r.unit === "CNY").reduce((s, r) => s + r.remaining, 0);
    expect(cnySum).toBe(0);
    expect(pickZhipuWallet(undefined, cnySum, false)).toBeUndefined();
  });
});

describe("measureLimit / parseQuotaLimits", () => {
  const fixture: ZhipuEnvelope = {
    code: 200,
    success: true,
    data: {
      level: "pro",
      limits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          usage: 800_000_000,
          currentValue: 127_694_464,
          remaining: 672_305_536,
          percentage: 15,
          nextResetTime: 1770648402389,
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          number: 7,
          usage: 4_000_000_000,
          currentValue: 2_000_000_000,
          remaining: 2_000_000_000,
          percentage: 50,
        },
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          usage: 4000,
          currentValue: 1828,
          remaining: 2172,
          percentage: 45,
        },
      ],
    },
  };

  it("有绝对计数时用 token / 次数，不用百分比冒充总量", () => {
    const fiveHour = measureLimit({
      type: "TOKENS_LIMIT",
      usage: 800_000_000,
      currentValue: 127_694_464,
      remaining: 672_305_536,
      percentage: 15,
    });
    expect(fiveHour).toEqual({
      used: 127_694_464,
      total: 800_000_000,
      remaining: 672_305_536,
      unit: "tokens",
    });
    expect(measureLimit({ type: "TIME_LIMIT", usage: 1000, remaining: 200 })?.unit).toBe("次");
  });

  it("只有百分比时退回 100 分制", () => {
    expect(measureLimit({ percentage: 32 })).toEqual({
      used: 32,
      total: 100,
      remaining: 68,
      unit: "%",
    });
  });

  it("按 5小时 → 每周 → MCP 排序，并带上套餐档位", () => {
    const { level, windows } = parseQuotaLimits(fixture);
    expect(level).toBe("Pro");
    expect(windows.map((w) => w.label)).toEqual(["5小时", "每周", "MCP / 工具"]);
    expect(windows[0]?.remaining).toBe(672_305_536);
    expect(windows[0]?.unit).toBe("tokens");
    expect(windows[2]?.unit).toBe("次");
    expect(windows[2]?.remaining).toBe(2172);
  });

  it("空 limits 不编造窗口", () => {
    expect(parseQuotaLimits({ data: { limits: [], level: "lite" } }).windows).toEqual([]);
    expect(parseQuotaLimits({}).windows).toEqual([]);
  });

  it("planLevelLabel 认识档位别名，未知值原样返回", () => {
    expect(planLevelLabel({ level: "max" })).toBe("Max");
    expect(planLevelLabel({ planName: "GLM Coding Max" })).toBe("GLM Coding Max");
    expect(planLevelLabel({})).toBeUndefined();
  });
});
