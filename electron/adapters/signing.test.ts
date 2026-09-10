import { describe, expect, it } from "vitest";
import {
  formatAcs3DateTime,
  formatSigV4Date,
  formatSigV4DateTime,
  randomNonce,
  sha256Hex,
  signAcs3,
  signSigV4,
} from "./signing";

/**
 * 请求签名。
 *
 * 在此之前，这 237 行的唯一验证依据是 scripts/verify-acs3.cjs —— 一个跑构建产物
 * 的手工脚本，不在 npm test 里。也就是说签名改坏了，测试是绿的，要等线上鉴权
 * 失败才发现；而它支撑着百炼与火山引擎两个适配器。
 *
 * 这里把官方向量接进测试套件。ACS3 用的是阿里云文档的「固定参数示例」自校验向量
 * （与那个脚本同一个值，见 signing.ts 的注释）；SigV4 没有同等权威的公开向量，
 * 因此只锁结构性质，不冒充「已对官方验证」。
 */

/** 阿里云官方固定参数示例的期望签名（help.aliyun.com v3-request-structure-and-signature） */
const ACS3_OFFICIAL_SIGNATURE =
  "06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0";

function acs3OfficialVector() {
  return signAcs3({
    method: "POST",
    uri: "/",
    query: {
      ImageId: "win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd",
      RegionId: "cn-shanghai",
    },
    host: "ecs.cn-shanghai.aliyuncs.com",
    headers: {
      "x-acs-action": "RunInstances",
      "x-acs-version": "2014-05-26",
      // 故意混入不该参与签名的 header，验证过滤逻辑
      accept: "application/json",
    },
    payload: "",
    ak: "YourAccessKeyId",
    sk: "YourAccessKeySecret",
    dateTimeISO: "2023-10-26T10:22:32Z",
    nonce: "3156853299f313e23d1673dc12e1703d",
  });
}

describe("signAcs3 对官方向量", () => {
  it("签名值与阿里云文档的自校验向量一致（回归）", () => {
    const { authorization } = acs3OfficialVector();
    expect(/Signature=([0-9a-f]+)$/.exec(authorization)?.[1]).toBe(
      ACS3_OFFICIAL_SIGNATURE,
    );
  });

  it("SignedHeaders 只含 host 与 x-acs-*，不含 accept", () => {
    // 排除规则写错时签名不会报错，只是服务端一律返回签名不匹配，
    // 排查起来只能靠肉眼比对文档
    const { authorization } = acs3OfficialVector();
    expect(authorization).toContain(
      "SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,",
    );
    expect(authorization).not.toContain("accept");
  });

  it("Credential 只放 AccessKeyId，不带 scope", () => {
    // 这是 ACS3 与 SigV4 的结构性差异之一：套用 SigV4 的 scope 会签错
    const { authorization } = acs3OfficialVector();
    expect(authorization).toContain("Credential=YourAccessKeyId,");
    expect(authorization).not.toContain("Credential=YourAccessKeyId/");
  });

  it("不参与签名的 header 仍照常发出去", () => {
    const { headers } = acs3OfficialVector();
    expect(headers.accept).toBe("application/json");
  });

  it("发送头里移除 host（由 fetch 依 URL 自动设置）", () => {
    const { headers } = acs3OfficialVector();
    expect(headers.host).toBeUndefined();
  });

  it("nonce 省略时自动生成，且两次不同", () => {
    const base = {
      method: "GET",
      uri: "/",
      query: {},
      host: "business.aliyuncs.com",
      headers: { "x-acs-action": "QueryAccountBalance" },
      payload: "",
      ak: "ak",
      sk: "sk",
      dateTimeISO: "2023-10-26T10:22:32Z",
    };
    const a = signAcs3(base).headers["x-acs-signature-nonce"];
    const b = signAcs3(base).headers["x-acs-signature-nonce"];
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("signSigV4 的结构性质", () => {
  const params = {
    method: "POST",
    uri: "/",
    query: { Action: "QueryBalanceAcct", Version: "2022-01-01" },
    host: "billing.volcengineapi.com",
    headers: { "content-type": "application/json; charset=utf-8" },
    payload: "{}",
    ak: "AKLT-test",
    sk: "secret",
    dateYYYYMMDD: "20260910",
    dateTimeISO: "20260910T120000Z",
    region: "cn-north-1",
    service: "billing",
    requestType: "request",
    algorithm: "HMAC-SHA256",
    dateHeader: "x-date",
    contentSha256Header: "x-content-sha256",
    unsignable: ["host", "content-type"],
  };

  it("相同输入得到相同签名（可复现）", () => {
    expect(signSigV4(params).authorization).toBe(signSigV4(params).authorization);
  });

  it("Credential 形如 AK/日期/区域/服务/requestType", () => {
    // 派生密钥链按这四段逐级 HMAC，任何一段错位都会签出完全不同的值
    const { authorization } = signSigV4(params);
    expect(authorization).toContain(
      "Credential=AKLT-test/20260910/cn-north-1/billing/request",
    );
    expect(authorization.startsWith("HMAC-SHA256 ")).toBe(true);
  });

  it("unsignable 里的 header 不参与签名（火山不签 host 与 content-type）", () => {
    const { authorization } = signSigV4(params);
    const signed = /SignedHeaders=([^,]+)/.exec(authorization)?.[1] ?? "";
    expect(signed).not.toContain("host");
    expect(signed).not.toContain("content-type");
    expect(signed).toContain("x-date");
    expect(signed).toContain("x-content-sha256");
  });

  it("携带时间戳与载荷摘要的头按参数名注入", () => {
    const { headers } = signSigV4(params);
    expect(headers["x-date"]).toBe("20260910T120000Z");
    expect(headers["x-content-sha256"]).toBe(sha256Hex("{}"));
  });

  it("发送头里移除 host", () => {
    expect(signSigV4(params).headers.host).toBeUndefined();
  });
});

describe("时间与随机数格式", () => {
  const d = new Date("2026-09-10T12:34:56.789Z");

  it("SigV4 用 ISO 基本格式（无分隔符）", () => {
    expect(formatSigV4DateTime(d)).toBe("20260910T123456Z");
    expect(formatSigV4Date(d)).toBe("20260910");
  });

  it("ACS3 用 ISO8601 扩展格式", () => {
    // 两种签名的时间格式不同，套错会被服务端判为时间戳非法
    expect(formatAcs3DateTime(d)).toBe("2026-09-10T12:34:56Z");
  });

  it("时间戳按 UTC 而非本地时区", () => {
    // 用本地时区会随机器时区偏移而签错
    expect(formatSigV4Date(new Date("2026-01-01T00:30:00Z"))).toBe("20260101");
    expect(formatAcs3DateTime(new Date("2026-01-01T23:30:00Z"))).toBe(
      "2026-01-01T23:30:00Z",
    );
  });

  it("randomNonce 是 32 位十六进制且无连字符", () => {
    for (let i = 0; i < 5; i++) {
      expect(randomNonce()).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

describe("sha256Hex", () => {
  it("与已知摘要一致", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
