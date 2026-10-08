import { Badge } from "@/components/ui/badge";
import type { ModelMonitorRecord, ModelMonitorSessionDay } from "@/types";

const modelKey = (r: ModelMonitorRecord) =>
  JSON.stringify([
    r.requestedModel ? "request" : r.responseModel ? "response" : "unknown",
    r.requestedModel ?? r.responseModel,
  ]);

/** 当天按「模型证据 + 模型名」聚合的会话组 */
export type ModelGroup = {
  key: string;
  model?: string;
  basis?: string;
  sessions: ModelMonitorSessionDay[];
  callCount: number;
  matched: number;
  mismatched: number;
  unknown: number;
  tokens: number;
};

/** 某天某个模型的汇总，展开后按会话列出 */
export function ModelGroupDetails({
  group,
  differencesOnly,
  visible,
}: {
  group: ModelGroup;
  differencesOnly: boolean;
  visible: ModelMonitorRecord[];
}) {
  return (
    <details data-monitor-model={group.key} className="rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm font-medium">{group.model ?? "未记录模型"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {group.basis === "request"
              ? "请求模型"
              : group.basis === "response"
                ? "仅记录响应模型"
                : "模型证据不足"}{" "}
            · {group.sessions.length} 个会话
          </p>
        </div>
        <span className="text-sm tabular-nums">请求 {group.callCount.toLocaleString()} 次</span>
        <Badge variant="success">一致 {group.matched}</Badge>
        <Badge variant={group.mismatched ? "warning" : "secondary"}>差异 {group.mismatched}</Badge>
        <Badge variant="secondary">无法核验 {group.unknown}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {group.tokens.toLocaleString()} Tokens
        </span>
      </summary>
      <div className="space-y-2 border-t p-3">
        {group.sessions
          .filter((session) => !differencesOnly || session.mismatchedCount > 0)
          .map((session) => (
            <SessionDetails
              key={session.sessionId}
              session={session}
              group={group}
              visible={visible}
            />
          ))}
      </div>
    </details>
  );
}

/** 单个会话在该模型下的调用明细表 */
function SessionDetails({
  session,
  group,
  visible,
}: {
  session: ModelMonitorSessionDay;
  group: ModelGroup;
  visible: ModelMonitorRecord[];
}) {
  return (
    <details data-monitor-session={session.sessionId} className="rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 break-all font-medium">{session.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          请求 {session.callCount.toLocaleString()} 次
        </span>
        <Badge variant="success">一致 {session.matchedCount}</Badge>
        <Badge variant={session.mismatchedCount ? "warning" : "secondary"}>
          差异 {session.mismatchedCount}
        </Badge>
        <Badge variant="secondary">无法核验 {session.unknownCount}</Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {session.totalTokens.toLocaleString()} Tokens
        </span>
      </summary>
      <div className="overflow-x-auto border-t px-2">
        <p className="px-3 py-3 text-xs text-muted-foreground">
          按天加载最近 200 条详情；汇总次数包含全部请求。当前会话已加载{" "}
          {
            visible.filter((r) => r.sessionId === session.sessionId && modelKey(r) === group.key)
              .length
          }{" "}
          条。
        </p>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              {["时间 / 会话", "该次所选模型", "响应 / 本地模型记录", "核对结果", "Tokens"].map(
                (h) => (
                  <th key={h} className="px-3 py-3 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible
              .filter((r) => r.sessionId === session.sessionId && modelKey(r) === group.key)
              .map((r) => (
                <MonitorRecordRow key={r.id} r={r} />
              ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** 明细表里的一次调用 */
function MonitorRecordRow({ r }: { r: ModelMonitorRecord }) {
  return (
    <tr className="border-b last:border-0">
      <td className="max-w-64 px-3 py-3 text-xs">
        <p className="tabular-nums text-muted-foreground">
          {new Date(r.startedAt).toLocaleTimeString()}
          {r.archived ? " · 已归档" : ""}
        </p>
        <p className="mt-1 truncate" title={r.sessionName}>
          {r.sessionName}
        </p>
        <details className="mt-1 text-muted-foreground">
          <summary className="cursor-pointer">标识详情</summary>
          <p className="mt-1 break-all">会话：{r.sessionId}</p>
          <p className="break-all">记录：{r.responseId ?? r.id}</p>
        </details>
        {r.modelCalls !== undefined && (
          <p className="mt-1 text-muted-foreground">
            该轮 {r.modelCalls} 次请求 · 一致 {r.matchedCalls ?? 0} · 差异 {r.mismatchedCalls ?? 0}{" "}
            · 未核验 {r.unverifiedCalls ?? r.modelCalls}
          </p>
        )}
      </td>
      <td className="break-all px-3 py-3 font-mono text-xs">
        {r.requestedModel ?? "会话未记录"}
        {r.sentModel && r.sentModel !== r.requestedModel && (
          <p className="mt-1 text-muted-foreground">发送名称：{r.sentModel}</p>
        )}
      </td>
      <td className="break-all px-3 py-3 text-xs">
        <p className="font-mono">{r.responseModel ?? r.reportedModel ?? "本地未记录"}</p>
        <p className="mt-1 text-muted-foreground">
          {r.evidence === "usage"
            ? "整轮用量分项 · 非独立响应证据"
            : r.evidence === "selection"
              ? "助手消息配置 · 非响应模型"
              : r.evidence === "generation-response"
                ? "生成记录 response_model"
                : r.responseModel
                  ? "响应模型记录"
                  : "响应证据缺失"}
        </p>
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <Badge
          variant={
            r.status === "match" ? "success" : r.status === "mismatch" ? "warning" : "secondary"
          }
        >
          {r.status === "match"
            ? "名称一致"
            : r.status === "mismatch"
              ? "名称差异"
              : r.responseModel
                ? "已记录响应"
                : r.reportedModel
                  ? "仅本地记录"
                  : "无法核验"}
        </Badge>
      </td>
      <td
        className="px-3 py-3 tabular-nums"
        title={`输入 ${r.inputTokens} · 输出 ${r.outputTokens}`}
      >
        {r.totalTokens.toLocaleString()}
      </td>
    </tr>
  );
}
