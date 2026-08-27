# v0.1.5 修复用量统计虚高问题

## 🔧 核心修复

### 所有 agent 用量统计虚高约 50% 的问题

**根本原因：**

对于 Codex 和 Grok Build（采用 OpenAI token 语义）：
- 原始数据中 `inputTokens` 已经包含了 `cacheReadTokens`
- UI 显示总量时又加了一次 `cacheReadTokens`
- 导致缓存读取的 token 被**双重计算**

**修复方案：**

1. **统一数据语义** - 在数据采集层面统一所有 agent 的 token 语义
   - Codex 和 Grok Build 在返回数据时，将 `inputTokens` 拆分为不含缓存的部分
   - `inputTokens = 原始 input - cacheReadTokens`
   - `cacheReadTokens` 单独存储

2. **简化费用计算** - 更新 `toCostTokens` 函数，移除冗余的拆分逻辑

3. **保持 UI 不变** - UI 层总量计算公式保持不变：
   ```typescript
   total = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + reasoningTokens
   ```

## 📊 影响范围

- ✅ Codex - 修复缓存 token 双重计算
- ✅ Grok Build - 修复缓存 token 双重计算  
- ✅ Claude Code - 无影响（原本就是正确的 Anthropic 语义）
- ✅ Antigravity - 无影响（不支持缓存）
- ✅ OpenCode - 无影响（不支持缓存）

## 🎯 用户操作

升级后**必须清除缓存**才能看到修正后的数据：

1. 打开应用 → 设置页面
2. 找到"本地用量缓存"卡片
3. 点击"清除缓存并重新扫描"
4. 返回用量/趋势页面查看修正后的数据

不清除缓存的话，旧数据仍会显示虚高的统计值。

## 🔍 技术细节

修复前（虚高场景）：
```
Codex 原始数据：input=1000（含 cache=300）, cache=300
存储：inputTokens=1000, cacheReadTokens=300
UI 显示总量：1000 + 300 = 1300 ✗（cache 被计算了两次）
```

修复后（正确）：
```
Codex 原始数据：input=1000（含 cache=300）, cache=300
存储：inputTokens=700（拆分后）, cacheReadTokens=300
UI 显示总量：700 + 300 = 1000 ✓
```

## 📝 相关修改

- `electron/local-usage/codex.ts` - 返回数据时拆分 inputTokens
- `electron/local-usage/grok-build.ts` - 返回数据时拆分 inputTokens
- `electron/local-usage/index.ts` - 简化 toCostTokens 逻辑
- `ui/src/pages/Usage.tsx` - 优化用量明细展示（按日期折叠）

## ✅ 测试结果

- 155 个单元测试全部通过
- TypeScript 类型检查通过

