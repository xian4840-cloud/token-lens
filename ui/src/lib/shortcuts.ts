export const PAGE_SHORTCUTS: { key: string; path: string; label: string }[] = [
  { key: "1", path: "/", label: "总览" },
  { key: "2", path: "/usage", label: "用量明细" },
  { key: "3", path: "/trends", label: "趋势" },
  { key: "4", path: "/services", label: "管理" },
  { key: "5", path: "/settings", label: "设置" },
];

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable === true;
}

/** Alt+数字切页。输入框里不触发。 */
export function pagePathForAltKey(e: KeyboardEvent): string | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (isTypingTarget(e.target)) return null;
  const hit = PAGE_SHORTCUTS.find((s) => s.key === e.key);
  return hit?.path ?? null;
}

export function isHelpKey(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return false;
  if (e.key === "F1") return true;
  if (e.key === "?" || (e.key === "/" && e.shiftKey)) return true;
  return false;
}

export function isRefreshKey(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return false;
  return e.key === "F5";
}

export function isCommandPaletteKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
}

const EXTRA_TITLES: Record<string, string> = {
  "/model-monitor": "模型监测",
  "/settings/pricing": "模型价格表",
  "/pet": "桌面宠物",
};

/** 窗口标题：让任务栏和读屏知道当前页，而不是永远「Token Lens」。 */
export function documentTitleForPath(pathname: string): string {
  const fromShortcut = PAGE_SHORTCUTS.find((s) => s.path === pathname)?.label;
  const label = fromShortcut ?? EXTRA_TITLES[pathname];
  return label ? `Token Lens · ${label}` : "Token Lens";
}
