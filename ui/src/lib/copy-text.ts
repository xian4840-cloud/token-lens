import { showToast } from "./toast";

export async function writeClipboard(
  text: string,
  write: (t: string) => Promise<void> = (t) => navigator.clipboard.writeText(t),
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await write(text);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "复制失败",
    };
  }
}

/** 复制后 toast。失败文案不静默。 */
export function copyText(text: string, okMessage = "已复制"): void {
  void writeClipboard(text).then((r) => {
    if (r.ok) showToast(okMessage);
    else showToast(r.error, "err");
  });
}