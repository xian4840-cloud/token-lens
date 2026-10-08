import { randomUUID } from "node:crypto";
import {
  getSecrets,
  getService,
  insertServiceWithSecrets,
  setNeedsCredentials,
  setSecrets,
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
 * 新建服务（services:create 的全部逻辑）。
 * 密钥先加密成功再落库，失败时不留下没有密钥的服务记录。
 */
export function createServiceFromInput(input: unknown): ServiceRecord {
  const valid = validateServiceInput(input);
  const def = getDefinition(valid.provider);
  if (!def) throw new Error(`未知服务类型: ${valid.provider}`);
  const { config, secrets } = splitFields(valid.provider, valid.fields);
  const now = new Date().toISOString();
  const record: ServiceRecord = {
    id: randomUUID(),
    name: valid.name,
    provider: valid.provider,
    kind: def.kind,
    config,
    createdAt: now,
    updatedAt: now,
  };
  insertServiceWithSecrets(record, secrets);
  return record;
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
  // 服务类型以库里的记录为准，不信渲染进程传来的 provider：否则传一个别的类型，
  // 就能按另一套字段定义拆分，把密钥字段当普通 config 明文落盘，或塞进不属于该服务的字段。
  if (input && typeof input === "object" && "provider" in input) {
    const claimed = (input as { provider?: unknown }).provider;
    if (claimed !== undefined && claimed !== existing.provider) {
      throw new Error("不能修改服务类型");
    }
  }
  const valid = validateServiceInput({
    ...(input && typeof input === "object" ? input : {}),
    provider: existing.provider,
  });
  const { config, secrets } = splitFields(existing.provider, valid.fields);
  // 密码字段非空才更新；留空表示保留旧值（便于编辑其他字段时不重填密码）。
  // 先加密、后改元数据：加密失败时整次编辑不生效
  const nonEmpty = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v));
  setSecrets(id, nonEmpty);
  updateServiceMeta(id, valid.name, config);
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
