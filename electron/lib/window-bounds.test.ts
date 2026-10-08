import { describe, expect, it } from "vitest";
import {
  clampWindowBounds,
  DEFAULT_WINDOW,
  parseWindowBounds,
} from "./window-bounds";

const primary = { x: 0, y: 0, width: 1920, height: 1040 };

describe("parseWindowBounds", () => {
  it("四值齐全且不小于最小尺寸才算有效", () => {
    expect(
      parseWindowBounds({
        windowX: "80",
        windowY: "40",
        windowWidth: "1280",
        windowHeight: "840",
      }),
    ).toEqual({ x: 80, y: 40, width: 1280, height: 840 });
  });

  it("缺一个或非数字则放弃，避免窗口飞出屏外", () => {
    expect(parseWindowBounds({ windowX: "80", windowY: "40" })).toBeNull();
    expect(
      parseWindowBounds({
        windowX: "nope",
        windowY: "0",
        windowWidth: "1280",
        windowHeight: "840",
      }),
    ).toBeNull();
  });

  it("小于最小尺寸视为无效", () => {
    expect(
      parseWindowBounds({
        windowX: "0",
        windowY: "0",
        windowWidth: "200",
        windowHeight: "200",
      }),
    ).toBeNull();
  });
});

describe("clampWindowBounds", () => {
  it("落在某块显示器工作区内则原样保留", () => {
    const bounds = { x: 100, y: 80, width: 1280, height: 840 };
    expect(clampWindowBounds(bounds, [primary])).toEqual(bounds);
  });

  it("外接屏拔掉后坐标落空，退回主屏默认位置", () => {
    const off = { x: 3000, y: 0, width: 1280, height: 840 };
    expect(clampWindowBounds(off, [primary])).toEqual({
      x: primary.x + 80,
      y: primary.y + 80,
      width: DEFAULT_WINDOW.width,
      height: DEFAULT_WINDOW.height,
    });
  });

  it("只露出一条边时夹进工作区，标题栏完全可见", () => {
    const peeking = { x: 1840, y: -40, width: 1280, height: 840 };
    const out = clampWindowBounds(peeking, [primary]);
    expect(out.x).toBeGreaterThanOrEqual(primary.x);
    expect(out.y).toBeGreaterThanOrEqual(primary.y);
    expect(out.x + out.width).toBeLessThanOrEqual(primary.x + primary.width);
    expect(out.y + out.height).toBeLessThanOrEqual(primary.y + primary.height);
  });

  it("落在第二块屏上时夹进那块屏，不退回主屏", () => {
    const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
    const bounds = { x: 2100, y: 80, width: 1280, height: 840 };
    expect(clampWindowBounds(bounds, [primary, secondary])).toEqual(bounds);
  });
});
