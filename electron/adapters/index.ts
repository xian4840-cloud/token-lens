import type { Adapter, ServiceDefinition } from "../types";
import { openaiAdapter } from "./openai";
import { openrouterAdapter } from "./openrouter";
import { deepseekAdapter } from "./deepseek";
import { siliconflowAdapter } from "./siliconflow";
import { groqAdapter } from "./groq";
import { geminiAdapter } from "./gemini";
import { togetherAdapter } from "./together";
import { anthropicAdapter } from "./anthropic";
import { bailianAdapter } from "./bailian";
import { volcengineAdapter } from "./volcengine";
import { volcenginePlanAdapter } from "./volcengine_plan";
import { scnetTokenPlanAdapter } from "./scnet_token_plan";
import { kimiAdapter } from "./kimi";

/**
 * 适配器注册表。新增服务只需：写一个 adapter 文件 -> 在此 import 并注册。
 */

const registry = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  registry.set(adapter.definition.provider, adapter);
}

export function getAdapter(provider: string): Adapter | undefined {
  return registry.get(provider);
}

export function getDefinition(provider: string): ServiceDefinition | undefined {
  return registry.get(provider)?.definition;
}

export function listDefinitions(): ServiceDefinition[] {
  return Array.from(registry.values()).map((a) => a.definition);
}

/** 注册全部适配器 */
export function registerAllAdapters(): void {
  registerAdapter(openaiAdapter);
  registerAdapter(openrouterAdapter);
  registerAdapter(deepseekAdapter);
  registerAdapter(siliconflowAdapter);
  registerAdapter(groqAdapter);
  registerAdapter(geminiAdapter);
  registerAdapter(togetherAdapter);
  registerAdapter(anthropicAdapter);
  registerAdapter(bailianAdapter);
  registerAdapter(volcengineAdapter);
  registerAdapter(volcenginePlanAdapter);
  registerAdapter(scnetTokenPlanAdapter);
  registerAdapter(kimiAdapter);
}
