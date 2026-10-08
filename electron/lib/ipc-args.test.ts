import { describe, expect, it } from "vitest";
import { optionalId, optionalProxyOverride, optionalTime, requireId, requireSettingKey } from "./ipc-args";

describe("IPC 参数校验", () => {
  it("requireId：非空字符串、限长", () => {
    expect(requireId("abc")).toBe("abc");
    for (const bad of [undefined, null, "", 1, {}, ["a"], "x".repeat(201)]) {
      expect(() => requireId(bad)).toThrow("无效的服务 id");
    }
  });
  it("optionalId：空值视为未传", () => {
    expect(optionalId(undefined)).toBeUndefined();
    expect(optionalId(null)).toBeUndefined();
    expect(optionalId("")).toBeUndefined();
    expect(optionalId("id-1")).toBe("id-1");
    expect(() => optionalId(5)).toThrow();
  });
  it("optionalTime：日期键与 ISO 时间放行，非时间字符串 / 非字符串拒绝", () => {
    expect(optionalTime("2026-10-01")).toBe("2026-10-01");
    expect(optionalTime("2026-10-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
    expect(optionalTime(undefined)).toBeUndefined();
    for (const bad of ["yesterday", 20261001, { toString: () => "2026-10-01" }, "2".repeat(65)]) {
      expect(() => optionalTime(bad)).toThrow("无效的时间");
    }
  });
  it("requireSettingKey：只认标识符形式的 key", () => {
    expect(requireSettingKey("disabledLocalSources")).toBe("disabledLocalSources");
    for (const bad of ["", "__proto__x".replace("x", "!"), "a b", 1, "x".repeat(65)]) {
      expect(() => requireSettingKey(bad)).toThrow("无效的设置项");
    }
  });
  it("optionalProxyOverride：只保留三个字符串字段，类型不对就拒绝", () => {
    expect(optionalProxyOverride(undefined)).toBeUndefined();
    expect(optionalProxyOverride({ mode: "custom", customUrl: "http://127.0.0.1:7890", extra: 1 })).toEqual({
      mode: "custom",
      customUrl: "http://127.0.0.1:7890",
    });
    expect(() => optionalProxyOverride({ mode: 1 })).toThrow("无效的代理配置");
    expect(() => optionalProxyOverride("custom")).toThrow("无效的代理配置");
    expect(() => optionalProxyOverride([])).toThrow("无效的代理配置");
  });
});
