/** 搜索框按 Esc 清空。有内容才拦截，空框把 Esc 留给对话框关闭。 */
export function applySearchEscape(
  e: { key: string; preventDefault: () => void },
  value: string,
  clear: () => void,
): boolean {
  if (e.key !== "Escape" || value === "") return false;
  e.preventDefault();
  clear();
  return true;
}
