import {
  getSecrets,
  getService,
  setNeedsCredentials,
  setSecret,
  updateServiceMeta,
} from "./db";
import { getDefinition } from "./adapters";
import { validateServiceInput } from "./validation";
import type { ServiceRecord } from "./types";

/** 按服务定义把表单字段拆分为非敏感 config 与敏感 secrets */
export function splitFields(
  provider: string,
  fields: Record<string, string>,
): { config: Record<string, unknown>; secrets: Record<string, string> } {
  const def = getDefinition(provider);
  if (!def) throw new Error(`未知服务类型: ${provider}`);
  const secretKeys = new Set(
    def.configSchema
      .filter((f) => f.type === "password" || f.secret)
      .map((f) => f.key),
  );
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (secretKeys.has(k)) secrets[k] = v;
    else config[k] = v;
  }
  return { config, secrets };
}

/**
 * 编辑服务（services:update 的全部逻辑）。
 *
 * 从 ipc 抽出来是为了能测「备份恢复的服务 -> 补填密钥 -> 标记清除 -> 能刷新」
 * 这条完整链路：ipc 依赖 Electron 起不来，这里只依赖 db 与适配器注册表。
 */
export function updateServiceFromInput(
  id: string,
  input: unknown,
): ServiceRecord | undefined {
  const existing = getService(id);
  if (!existing) throw new Error("服务不存在");
  const valid = validateServiceInput(input);
  const { config, secrets } = splitFields(valid.provider, valid.fields);
  updateServiceMeta(id, valid.name, config);
  // 密码字段非空才更新；留空表示保留旧值（便于编辑其他字段时不重填密码）
  for (const [k, v] of Object.entries(secrets)) {
    if (v) setSecret(id, k, v);
  }
  // 备份恢复的服务：必填的密钥字段都补上了才算可用，清掉「需重新填写」标记
  if (existing.needsCredentials) {
    const def = getDefinition(existing.provider);
    const stored = getSecrets(id);
    const missing = (def?.configSchema ?? []).some(
      (f) => f.required && (f.type === "password" || f.secret) && !stored[f.key],
    );
    if (!missing) setNeedsCredentials(id, false);
  }
  return getService(id);
}
