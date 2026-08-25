/**
 * 服务名称与服务类型的同步规则。
 *
 * 抽成纯函数是为了能测：这条逻辑防的是一个已经真实发生过的错误——
 * 先选「阿里云百炼」把名称填成「百炼」，再改选「超算互联网 Token Plan」，
 * 名称却没跟着变，结果得到一张标题写「百炼」、实际查超算互联网的卡片。
 */

interface DefinitionLike {
  provider: string;
  label: string;
}

/**
 * 判断当前名称是否属于「用户没真正自定义过」的状态，即可以安全覆盖。
 *
 * 空白算未定制；恰好等于任一服务类型默认名的也算——那说明它是上一次
 * 自动填入的，不是用户的心意。反之像「工作号」这类自定义名必须保住，
 * 用户给账号起的区分名比服务类型名重要得多。
 */
export function isAutoFilledName(
  name: string,
  definitions: readonly DefinitionLike[],
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return definitions.some((d) => d.label === trimmed);
}

/**
 * 计算切换服务类型后应采用的名称。
 * 用户自定义过则原样保留，否则跟随新服务类型的默认名。
 */
export function nextServiceName(
  currentName: string,
  nextProvider: string,
  definitions: readonly DefinitionLike[],
): string {
  if (!isAutoFilledName(currentName, definitions)) return currentName;
  return definitions.find((d) => d.provider === nextProvider)?.label ?? "";
}
