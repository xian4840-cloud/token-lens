/** 批量结束后要不要提示。成功不打扰，失败才说。 */
export function batchFailureMessage(
  total: number,
  failed: number,
  allFailed: string,
  someFailed: (n: number) => string,
): string | null {
  if (total <= 0 || failed <= 0) return null;
  if (failed === total) return allFailed;
  return someFailed(failed);
}

export function refreshFailureMessage(total: number, failed: number): string | null {
  return batchFailureMessage(total, failed, "全部刷新失败", (n) => `${n} 个服务刷新失败`);
}

export function usageRefreshFailureMessage(total: number, failed: number): string | null {
  return batchFailureMessage(total, failed, "全部用量刷新失败", (n) => `${n} 个服务用量刷新失败`);
}
