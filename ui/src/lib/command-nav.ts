/** 命令列表里方向键移动。length 为 0 时停在 0，不出现 -1。 */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

/** 过滤结果变短时把高亮夹回范围内。 */
export function clampIndex(current: number, length: number): number {
  if (length <= 0) return 0;
  if (current < 0) return 0;
  return Math.min(current, length - 1);
}
