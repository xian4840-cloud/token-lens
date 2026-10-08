/** 主进程 disable*Capture 的返回值（electron/agent-response-capture.ts 的 CaptureRemovalResult） */
export interface CaptureRemovalResult {
  removed: string[];
  kept: string[];
}

/** 「关闭采集」完成后的提示文案 */
export function formatCaptureRemoval(
  source: "claude-code" | "opencode",
  result: CaptureRemovalResult,
): string {
  const parts: string[] = [];
  // 主进程在 BUN_OPTIONS 仍引用采集脚本（或注册表改不了）时，会把整套脚本保留，
  // 并在 kept 第一项（以 HKCU\Environment\BUN_OPTIONS 或 BUN_OPTIONS 开头）说明原因
  const envIssue = result.kept.find((k) => /^(HKCU\\Environment\\)?BUN_OPTIONS/.test(k));
  if (envIssue) {
    parts.push(
      `采集脚本已保留：${envIssue}。为避免 Claude Code 因找不到预加载脚本而无法启动，没有删除任何采集文件；` +
        "手动清理 BUN_OPTIONS 后再点一次「关闭采集」即可。",
    );
    return parts.join(" ");
  }
  if (result.removed.length === 0) {
    parts.push("没有找到需要清理的采集文件。");
  } else {
    parts.push(
      source === "claude-code"
        ? `已关闭，清理了 ${result.removed.length} 项。已打开的终端还带着旧的环境变量，关闭后重新打开即可恢复原样。`
        : `已关闭，清理了 ${result.removed.length} 项。重新打开 OpenCode 后生效。`,
    );
  }
  if (result.kept.length) {
    parts.push(`以下内容不是 Token Lens 创建的（或目录里还有其他文件），已保留：${result.kept.join("；")}`);
  }
  return parts.join(" ");
}
