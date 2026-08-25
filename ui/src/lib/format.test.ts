import { describe, expect, it } from "vitest";
import {
  balanceCaption,
  formatBalance,
  formatMoney,
  formatTime,
  formatTokens,
  formatTokensCn,
  usedPercent,
  // 走 @ alias 而非相对路径：顺带守卫 vitest.config.mts 的 alias 配置，
  // 配错了这里会直接解析失败，而不是等到某个组件测试才暴露
} from "@/lib/format";

describe("formatTokens", () => {
  it("千以下原样输出", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("按量级简写为 K / M / B", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(1_000_000)).toBe("1.00M");
    expect(formatTokens(1_500_000_000)).toBe("1.50B");
  });

  it("缺值返回占位符", () => {
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(Number.NaN)).toBe("—");
  });
});

describe("formatMoney", () => {
  it("按币种加符号并保留两位小数", () => {
    expect(formatMoney(12.5, "USD")).toBe("$12.50");
    expect(formatMoney(12.5, "CNY")).toBe("¥12.50");
  });

  it("未知币种不加符号", () => {
    expect(formatMoney(3, "EUR")).toBe("3.00");
  });

  it("缺值返回占位符", () => {
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("formatBalance", () => {
  it("金额币种走货币格式", () => {
    expect(formatBalance(12.5, "USD")).toBe("$12.50");
    expect(formatBalance(12.5, "CNY")).toBe("¥12.50");
  });

  it("tokens 与百分比各有专用格式", () => {
    expect(formatBalance(1_234_567, "tokens")).toBe("1.23M tokens");
    expect(formatBalance(87.5, "%")).toBe("87.5%");
  });

  // 回归：曾把 Credits 落进 formatMoney，显示成无单位裸数字 5000000.00
  it("计量单位大数简写并带单位（超算互联网 Credits 回归）", () => {
    expect(formatBalance(5_000_000, "Credits")).toBe("5.00M Credits");
    expect(formatBalance(250, "Credits")).toBe("250 Credits");
  });

  // 注意占位符与 formatMoney/formatTokens 的破折号不一致，此处钉住现状
  it("缺值返回连字符占位", () => {
    expect(formatBalance(undefined, "USD")).toBe("-");
    expect(formatBalance(Number.NaN, "Credits")).toBe("-");
  });
});

describe("usedPercent", () => {
  it("按 used/total 换算百分比", () => {
    expect(usedPercent(250, 1000)).toBe(25);
    expect(usedPercent(0, 1000)).toBe(0);
    expect(usedPercent(1000, 1000)).toBe(100);
  });

  // 回归：曾直接把 used 当百分比，绝对值计量的服务进度条一律满格
  it("绝对值计量不被当成百分比（超算互联网回归）", () => {
    expect(usedPercent(250, 5_000_000)).toBeCloseTo(0.005, 6);
  });

  // 火山方舟按 Percent 计，total 恰为 100，换算后应等于原值
  it("total 为 100 时等于 used 本身（火山方舟）", () => {
    expect(usedPercent(87.5, 100)).toBe(87.5);
  });

  it("越界值被夹到 0-100", () => {
    expect(usedPercent(150, 100)).toBe(100);
    expect(usedPercent(-5, 100)).toBe(0);
  });

  it("total 缺失或非正数时返回 0，不产生除零", () => {
    expect(usedPercent(50, undefined)).toBe(0);
    expect(usedPercent(50, 0)).toBe(0);
    expect(usedPercent(50, -100)).toBe(0);
    expect(usedPercent(undefined, 100)).toBe(0);
  });

  // 进度条宽度会被插进 CSS，NaN 会渲染成非法样式，必须兜成 0
  it("used 为 NaN 时返回 0 而非 NaN", () => {
    expect(usedPercent(Number.NaN, 100)).toBe(0);
  });

  // 脏数据渲染成满条等于谎称「已用尽」，宁可空条
  it("used 为 Infinity 时返回 0 而非满条", () => {
    expect(usedPercent(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });

  it("total 为 NaN 或 Infinity 时返回 0", () => {
    expect(usedPercent(50, Number.NaN)).toBe(0);
    expect(usedPercent(50, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("balanceCaption", () => {
  it("同时有余额与已用时说明已用多少", () => {
    expect(balanceCaption({ remaining: 70, used: 30, currency: "USD" })).toBe(
      "已用 $30.00",
    );
  });

  it("只有已用时标为本月用量（OpenAI / Anthropic）", () => {
    expect(balanceCaption({ used: 30, currency: "USD" })).toBe("本月用量");
  });

  // 回归：多数适配器只返回 remaining，早先据 used 是否存在判断，
  // 导致能查到余额的服务副行写成「该服务无余额查询 API」，自相矛盾
  it("只有余额时标为可用余额（deepseek / 硅基流动 / 火山 / Kimi）", () => {
    expect(balanceCaption({ remaining: 88.88, currency: "CNY" })).toBe("可用余额");
  });

  it("两者都没有时说明该服务无余额接口（Gemini / Groq / Together）", () => {
    expect(balanceCaption({ currency: "USD" })).toBe("该服务无余额查询 API");
  });

  it("NaN 不算有效数字，不谎称可用余额", () => {
    expect(balanceCaption({ remaining: Number.NaN, currency: "USD" })).toBe(
      "该服务无余额查询 API",
    );
  });

  it("已用为 0 仍算有效（刚开通未消费）", () => {
    expect(balanceCaption({ remaining: 100, used: 0, currency: "USD" })).toBe(
      "已用 $0.00",
    );
  });
});

describe("formatTokensCn", () => {
  it("按万 / 亿简写", () => {
    expect(formatTokensCn(12_345)).toBe("1.2万");
    expect(formatTokensCn(123_456_789)).toBe("1.2亿");
    expect(formatTokensCn(999)).toBe("999");
  });

  it("负数按绝对值判量级", () => {
    expect(formatTokensCn(-12_345)).toBe("-1.2万");
  });

  it("缺值返回连字符占位", () => {
    expect(formatTokensCn(null)).toBe("-");
    expect(formatTokensCn(undefined)).toBe("-");
  });
});

describe("formatTime", () => {
  it("非法或缺失时间返回占位符", () => {
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime("")).toBe("—");
    expect(formatTime("not-a-date")).toBe("—");
  });

  it("合法 ISO 时间输出月日时分", () => {
    // 固定时区偏移的输入，避免依赖运行机器时区
    const out = formatTime("2026-08-25T13:45:00+08:00");
    expect(out).toMatch(/\d{2}\/\d{2}/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});
