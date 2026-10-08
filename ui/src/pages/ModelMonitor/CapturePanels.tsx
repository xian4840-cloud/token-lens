import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ModelMonitorState, ModelMonitorSource } from "@/types";

/** Codex 桌面实时采集的入口与状态 */
export function CodexCapturePanel({
  state,
  launching,
  captureMessage,
  launchCodex,
}: {
  state: ModelMonitorState | null;
  launching: boolean;
  captureMessage: string;
  launchCodex: () => Promise<void>;
}) {
  return (
    <div className="mb-4 space-y-2 rounded-lg border bg-muted/30 p-4" data-codex-capture>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">
            桌面实时采集{" "}
            <Badge className="ml-2" variant="secondary">
              实验功能 · Windows
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {state?.capture.active
              ? `已捕获 ${state.capture.responseCount} 次响应，继续在 Codex 中聊天即可。`
              : state?.capture.ready
                ? "采集器已准备好。退出 Codex 后，从这里启动即可采集。"
                : "先退出 Codex，再从这里启动。首次启动会准备本地采集器。"}
          </p>
        </div>
        <Button
          size="sm"
          disabled={launching || !state?.capture.supported || state.capture.active}
          onClick={() => void launchCodex()}
        >
          {launching ? "正在准备…" : state?.capture.active ? "采集已连接" : "启动 Codex 并采集"}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        使用现有官方登录，只保存响应
        ID、模型名称与时间，不保存聊天正文。采集器不额外发送模型请求。每次从这个入口启动 Codex
        才会启用采集；恢复普通使用时，退出 Codex 后通过原来的快捷方式打开。
      </p>
      {!state?.capture.supported && state && (
        <p className="text-xs text-muted-foreground">
          当前系统仅支持查看历史记录，桌面实时采集第一版支持 Windows。
        </p>
      )}
      {state?.capture.lastResponseAt && (
        <p className="text-xs text-muted-foreground">
          最近捕获：{new Date(state.capture.lastResponseAt).toLocaleString()}
        </p>
      )}
      {(captureMessage || state?.capture.error) && (
        <p className="text-sm" role="status">
          {state?.capture.error || captureMessage}
        </p>
      )}
    </div>
  );
}

/** Claude Code / OpenCode 的响应模型核验开关 */
export function AgentCapturePanel({
  source,
  state,
  launching,
  captureMessage,
  enableAgentCapture,
  disableAgentCapture,
}: {
  source: ModelMonitorSource;
  state: ModelMonitorState | null;
  launching: boolean;
  captureMessage: string;
  enableAgentCapture: () => Promise<void>;
  disableAgentCapture: () => Promise<void>;
}) {
  return (
    <div
      className="mb-4 rounded-lg border bg-muted/30 p-4"
      data-opencode-capture={source === "opencode" ? true : undefined}
      data-claude-capture={source === "claude-code" ? true : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">响应模型核验</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {state?.agentCapture?.requestCount
              ? `已采集 ${state.agentCapture.requestCount} 次请求，读到 ${state.agentCapture.responseCount} 次响应模型。`
              : state?.agentCapture?.enabled
                ? source === "claude-code"
                  ? "在新终端中启动 Claude Code，正常聊天即可。"
                  : "重新打开 OpenCode，正常聊天即可。"
                : "启用一次，在 Agent 自身进程内记录请求与响应模型，无额外后台进程。"}
          </p>
        </div>
        <div className="flex gap-2">
          {(state?.agentCapture?.enabled || state?.agentCapture?.installed) && (
            <Button
              size="sm"
              variant="outline"
              data-disable-capture
              disabled={launching}
              onClick={() => void disableAgentCapture()}
            >
              关闭采集
            </Button>
          )}
          <Button
            size="sm"
            disabled={launching || state?.agentCapture?.enabled}
            onClick={() => void enableAgentCapture()}
          >
            {launching ? "正在处理…" : state?.agentCapture?.enabled ? "已启用" : "启用响应核验"}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        仅记录模型、标识、时间和用量，不保存聊天正文或密钥。
      </p>
      {captureMessage && (
        <p className="mt-2 text-sm" role="status">
          {captureMessage}
        </p>
      )}
    </div>
  );
}
