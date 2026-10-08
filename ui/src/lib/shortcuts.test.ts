import { describe, expect, it } from "vitest";
import {
  documentTitleForPath,
  isCommandPaletteKey,
  isHelpKey,
  isRefreshKey,
  pagePathForAltKey,
} from "./shortcuts";

function key(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...partial,
  } as KeyboardEvent;
}

describe("pagePathForAltKey", () => {
  it("Alt+1 到 Alt+5 切页", () => {
    expect(pagePathForAltKey(key({ key: "1", altKey: true }))).toBe("/");
    expect(pagePathForAltKey(key({ key: "3", altKey: true }))).toBe("/trends");
    expect(pagePathForAltKey(key({ key: "5", altKey: true }))).toBe("/settings");
  });

  it("没按 Alt 或在输入框里不切", () => {
    expect(pagePathForAltKey(key({ key: "1" }))).toBeNull();
    const input = { tagName: "INPUT", isContentEditable: false };
    expect(
      pagePathForAltKey(key({ key: "1", altKey: true, target: input as unknown as EventTarget })),
    ).toBeNull();
  });
});

describe("help / refresh keys", () => {
  it("F1 和 ? 打开说明，F5 刷新", () => {
    expect(isHelpKey(key({ key: "F1" }))).toBe(true);
    expect(isHelpKey(key({ key: "?" }))).toBe(true);
    expect(isRefreshKey(key({ key: "F5" }))).toBe(true);
    expect(isRefreshKey(key({ key: "r" }))).toBe(false);
  });

  it("Ctrl+K / Meta+K 打开命令面板", () => {
    expect(isCommandPaletteKey(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isCommandPaletteKey(key({ key: "k", metaKey: true }))).toBe(true);
    expect(isCommandPaletteKey(key({ key: "k" }))).toBe(false);
  });
});

describe("documentTitleForPath", () => {
  it("已知页带中文名", () => {
    expect(documentTitleForPath("/")).toBe("Token Lens · 总览");
    expect(documentTitleForPath("/usage")).toBe("Token Lens · 用量明细");
    expect(documentTitleForPath("/settings/pricing")).toBe("Token Lens · 模型价格表");
    expect(documentTitleForPath("/pet")).toBe("Token Lens · 桌面宠物");
  });

  it("未知路径不加假名字", () => {
    expect(documentTitleForPath("/nope")).toBe("Token Lens");
  });
});
