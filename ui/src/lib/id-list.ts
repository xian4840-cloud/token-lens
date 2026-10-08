/**
 * 设置里存的 ID 数组（JSON 字符串）。置顶 / 隐藏走这条路。
 * 解析失败返回空而不是抛——脏数据不该让界面起不来。
 * 主进程同名函数会写日志；渲染进程这边只保证不崩。
 */
export function parseIdList(raw: string | undefined | null): string[] {
  if (raw == null || raw.trim() === "") return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of v) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (!id || id.length > 80 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= 200) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** 置顶的排前面，未置顶保持原顺序。 */
export function sortPinnedFirst<T extends { id: string }>(
  items: T[],
  pinned: string[],
): T[] {
  if (pinned.length === 0) return items;
  const rank = new Map(pinned.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ap = rank.has(a.id);
    const bp = rank.has(b.id);
    if (ap && bp) return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    if (ap) return -1;
    if (bp) return 1;
    return 0;
  });
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}