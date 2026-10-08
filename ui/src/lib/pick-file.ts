/**
 * 读取用户挑中的文本文件。失败必须带回原因，不能让调用方空 then。
 */
export async function readFileAsText(
  file: Pick<File, "text">,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    return { ok: true, text: await file.text() };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "读取文件失败",
    };
  }
}

/** 弹出系统文件选择。取消或没选文件返回 null。 */
export function pickTextFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}