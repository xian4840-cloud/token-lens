export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW = { width: 1280, height: 840 };
const MIN_WIDTH = 960;
const MIN_HEIGHT = 620;

export function parseWindowBounds(settings: {
  windowX?: string;
  windowY?: string;
  windowWidth?: string;
  windowHeight?: string;
}): Rect | null {
  const x = Number(settings.windowX);
  const y = Number(settings.windowY);
  const width = Number(settings.windowWidth);
  const height = Number(settings.windowHeight);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  return { x, y, width, height };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 把窗口夹进某块工作区：标题栏必须完全可见，尺寸不超过该屏。
 * 只露出一条边（以前只要重叠 80px 就原样恢复）时也会被推进来。
 * 与任何屏都没有重叠（拔了外接屏）则退回主屏默认位置。
 */
export function clampWindowBounds(bounds: Rect, workAreas: Rect[]): Rect {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 };
  let wa = primary;
  let best = -1;
  for (const d of workAreas) {
    const area = overlapArea(bounds, d);
    if (area > best) {
      best = area;
      wa = d;
    }
  }
  if (best <= 0) {
    return {
      x: primary.x + 80,
      y: primary.y + 80,
      width: Math.min(DEFAULT_WINDOW.width, primary.width),
      height: Math.min(DEFAULT_WINDOW.height, primary.height),
    };
  }
  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), wa.width);
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), wa.height);
  const x = Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}
