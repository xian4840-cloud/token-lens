import { useEffect, useState } from "react";
import { ScanEye, RefreshCw, ChevronDown, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCaptureRemoval } from "@/lib/capture-removal";
import { highRiskNotExecutedMessage } from "@/lib/high-risk";
import { ipc } from "@/lib/ipc";
import { MONITOR_POLL_MS, startVisiblePoll } from "@/lib/visible-poll";
import type { ModelMonitorState, ModelMonitorSource } from "@/types";
import { ModelGroupDetails, type ModelGroup } from "./MonitorDetails";
import { CodexCapturePanel, AgentCapturePanel } from "./CapturePanels";

const sources: Record<ModelMonitorSource, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  "grok-build": "Grok Build",
  antigravity: "Antigravity",
};

export function ModelMonitor() {
  const [state, setState] = useState<ModelMonitorState | null>(null);
  const [source, setSource] = useState<ModelMonitorSource>("codex");
  const [date, setDate] = useState<string>();
  const [search, setSearch] = useState("");
  const [auto, setAuto] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [captureMessage, setCaptureMessage] = useState("");

  async function enableAgentCapture() {
    setLaunching(true);
    setCaptureMessage("");
    try {
      const result =
        source === "claude-code"
          ? await ipc.enableClaudeCapture()
          : await ipc.enableOpenCodeCapture();
      // 主进程会先弹系统确认框；用户取消时什么也不显示
      if (result.status !== "ok") {
        setCaptureMessage(highRiskNotExecutedMessage(result));
        return;
      }
      setCaptureMessage(
        source === "claude-code"
          ? "已启用。关闭旧终端，打开新终端后正常启动 Claude Code 即可。"
          : "已启用。重新打开 OpenCode 后正常聊天即可。",
      );
    } catch (e) {
      setCaptureMessage(e instanceof Error ? e.message : "安装失败");
    } finally {
      setLaunching(false);
      setRefresh((v) => v + 1);
    }
  }

  async function disableAgentCapture() {
    if (source !== "claude-code" && source !== "opencode") return;
    setLaunching(true);
    setCaptureMessage("");
    try {
      // 确认由主进程的系统确认框负责（列出要改的环境变量和文件），页面里不再重复弹框
      const result =
        source === "claude-code"
          ? await ipc.disableClaudeCapture()
          : await ipc.disableOpenCodeCapture();
      if (result.status !== "ok") {
        setCaptureMessage(highRiskNotExecutedMessage(result));
        return;
      }
      setCaptureMessage(formatCaptureRemoval(source, result.value));
    } catch (e) {
      setCaptureMessage(e instanceof Error ? e.message : "关闭失败");
    } finally {
      setLaunching(false);
      setRefresh((v) => v + 1);
    }
  }

  async function launchCodex() {
    setLaunching(true);
    setCaptureMessage("");
    try {
      const result = await ipc.launchCapturedCodex();
      if (result.status !== "ok") {
        setCaptureMessage(highRiskNotExecutedMessage(result));
        return;
      }
      setCaptureMessage("已发送启动命令，正在等待 Codex 后端连接。连接后正常聊天即可采集。");
    } catch (e) {
      setCaptureMessage(e instanceof Error ? e.message : "桌面采集启动失败");
    } finally {
      setLaunching(false);
      setRefresh((v) => v + 1);
    }
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      if (alive) setBusy(true);
      try {
        const next = await ipc.getModelMonitorState(date, source);
        if (alive) {
          setState(next);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "读取本地会话失败");
      } finally {
        if (alive) setBusy(false);
      }
    }
    // 窗口最小化 / 藏到托盘时暂停，重新可见时立刻补一轮
    const stop = startVisiblePoll(load, { repeat: auto });
    return () => {
      alive = false;
      stop();
    };
  }, [date, auto, refresh, source]);

  const records = state?.records ?? [];
  const visible = differencesOnly ? records.filter((r) => r.status === "mismatch") : records;
  const days = state?.days ?? [];
  const verified = days.reduce((sum, day) => sum + day.verifiedCount, 0);
  const mismatches = days.reduce((sum, day) => sum + day.mismatchCount, 0);
  const responses = days.reduce((sum, day) => sum + day.responseCount, 0);
  const candidates = days.filter((day) =>
    `${day.date} ${day.models.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
  );

  const modelGroups = new Map<string, ModelGroup>();
  for (const session of state?.sessionDays ?? []) {
    const key = JSON.stringify([session.modelBasis, session.model]);
    const group = modelGroups.get(key) ?? {
      key,
      model: session.model,
      basis: session.modelBasis,
      sessions: [],
      callCount: 0,
      matched: 0,
      mismatched: 0,
      unknown: 0,
      tokens: 0,
    };
    group.sessions.push(session);
    group.callCount += session.callCount;
    group.matched += session.matchedCount;
    group.mismatched += session.mismatchedCount;
    group.unknown += session.unknownCount;
    group.tokens += session.totalTokens;
    modelGroups.set(key, group);
  }

  return (
    <>
      <PageHeader
        title="模型监测"
        description="按天汇总本机 Agent 记录，展开日期查看模型与会话详情。"
      />
      <div className="space-y-4 p-6 pt-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="选择监测 Agent">
          {Object.entries(sources).map(([key, name]) => (
            <Button
              key={key}
              data-monitor-source={key}
              aria-pressed={source === key}
              variant={source === key ? "default" : "outline"}
              onClick={() => {
                if (source === key) return;
                setSource(key as ModelMonitorSource);
                setState(null);
                setDate(undefined);
                setSearch("");
                setDifferencesOnly(false);
                setError("");
                setCaptureMessage("");
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 font-display text-lg">
                <ScanEye className="size-5" aria-hidden />
                本地 {sources[source]} 监测
              </CardTitle>
              <Badge variant={state?.capture.active || verified ? "success" : "secondary"}>
                {state?.capture.active
                  ? "桌面采集已连接"
                  : verified
                    ? `可核对 ${verified.toLocaleString()} 次`
                    : state?.agentCapture?.enabled
                      ? "已启用 · 等待新请求"
                      : "尚无可核对记录"}
              </Badge>
            </div>
            <CardDescription>
              {state?.description ??
                (source === "codex"
                  ? "读取本地当前与归档会话；启用桌面采集后，可核对后续响应的模型。无需填写 URL。"
                  : "读取已有本地记录，无需填写 URL，无需从 Token Lens 启动 Agent。")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {source === "codex" && (
              <CodexCapturePanel
                state={state}
                launching={launching}
                captureMessage={captureMessage}
                launchCodex={launchCodex}
              />
            )}
            {(source === "opencode" || source === "claude-code") && (
              <AgentCapturePanel
                source={source}
                state={state}
                launching={launching}
                captureMessage={captureMessage}
                enableAgentCapture={enableAgentCapture}
                disableAgentCapture={disableAgentCapture}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {state?.sessions.length ?? "—"} 个会话 · {state ? days.length : "—"} 天 ·{" "}
                {state?.callCount.toLocaleString() ?? "—"} 次请求
              </span>
              <div className="flex items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={auto}
                    onChange={(e) => setAuto(e.target.checked)}
                  />
                  每 {MONITOR_POLL_MS / 1000} 秒更新
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  <RefreshCw
                    className={`mr-2 size-3.5 ${busy ? "animate-spin" : ""}`}
                    aria-hidden
                  />
                  立即刷新
                </Button>
              </div>
            </div>
            <details className="space-y-1 break-all text-xs text-muted-foreground">
              <summary className="cursor-pointer">查看本地数据来源</summary>
              {state && <p>本地目录：{state.root}</p>}
              {state?.scannedAt && <p>读取时间：{new Date(state.scannedAt).toLocaleString()}</p>}
            </details>
            {(error || state?.unavailable) && (
              <p className="text-sm text-destructive" role="alert">
                {error || state?.unavailable}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="flex flex-wrap items-center gap-2 font-display text-lg">
                <CalendarDays className="size-5" aria-hidden />
                每日汇总
                <Badge variant="secondary">
                  响应可读 {responses.toLocaleString()} · 可核对 {verified.toLocaleString()} · 差异{" "}
                  {mismatches.toLocaleString()}
                </Badge>
              </CardTitle>
              <Input
                className="max-w-64"
                aria-label="搜索日期或模型"
                placeholder="搜索日期 / 模型"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <CardDescription>
              按日期和模型分别统计，点击模型查看各会话次数。
              {source === "grok-build"
                ? "Grok 逐次核对，详情中的一轮可能包含多次模型调用。"
                : "同一会话重复写入的记录只计一次。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {candidates.length === 0 ? (
              <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                <ScanEye className="mx-auto mb-3 size-7 opacity-60" aria-hidden />
                {busy
                  ? "正在汇总本地会话，首次读取可能需要几秒…"
                  : search
                    ? "没有匹配的日期或模型。"
                    : "本地会话尚未记录可读取的调用用量。"}
              </div>
            ) : (
              <div className="space-y-3">
                {candidates.map((day) => (
                  <details
                    key={day.date}
                    data-monitor-day={day.date}
                    open={date === day.date}
                    className="rounded-lg border"
                  >
                    <summary
                      className="flex cursor-pointer list-none flex-wrap items-center gap-4 p-4 hover:bg-muted/30 [&::-webkit-details-marker]:hidden"
                      onClick={(e) => {
                        e.preventDefault();
                        setDate((current) => (current === day.date ? undefined : day.date));
                        setDifferencesOnly(false);
                      }}
                    >
                      <ChevronDown
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${date === day.date ? "" : "-rotate-90"}`}
                        aria-hidden
                      />
                      <span className="font-medium tabular-nums">{day.date}</span>
                      <span className="text-sm text-muted-foreground">
                        {day.sessionCount} 个会话 · {day.callCount.toLocaleString()} 次请求
                      </span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {day.totalTokens.toLocaleString()} Tokens
                      </span>
                      <div className="ml-auto flex flex-wrap gap-2">
                        {day.verifiedCount > 0 && (
                          <Badge variant="success">可核对 {day.verifiedCount}</Badge>
                        )}
                        {day.responseCount > 0 && (
                          <Badge variant="secondary">响应可读 {day.responseCount}</Badge>
                        )}
                        {day.mismatchCount > 0 && (
                          <Badge variant="warning">差异 {day.mismatchCount}</Badge>
                        )}
                        {day.unknownCount > 0 && (
                          <Badge variant="secondary">无法核验 {day.unknownCount}</Badge>
                        )}
                      </div>
                    </summary>
                    {date === day.date && (
                      <div className="border-t px-4 pb-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
                          <span>
                            各模型次数包含当天全部会话 · 涉及模型：
                            {day.models.join("、") || "未记录"}
                          </span>
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={differencesOnly}
                              onChange={(e) => setDifferencesOnly(e.target.checked)}
                            />
                            只看差异
                          </label>
                        </div>
                        {state?.selectedDate !== day.date ? (
                          <p className="py-5 text-sm text-muted-foreground">正在读取当天详情…</p>
                        ) : !(state?.sessionDays ?? []).some(
                            (s) => !differencesOnly || s.mismatchedCount > 0,
                          ) ? (
                          <p className="py-5 text-sm text-muted-foreground">
                            {differencesOnly
                              ? "没有已记录的模型名称差异；证据不足的调用无法判断。"
                              : "当天暂无可读取的调用详情。"}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {[...modelGroups.values()]
                              .sort((a, b) => b.callCount - a.callCount)
                              .filter((group) => !differencesOnly || group.mismatched > 0)
                              .map((group) => (
                                <ModelGroupDetails
                                  key={group.key}
                                  group={group}
                                  differencesOnly={differencesOnly}
                                  visible={visible}
                                />
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
            <p className="mt-5 text-xs leading-5 text-muted-foreground">
              汇总包含全部可读取记录；展开后展示当天最近 200
              条。先按模型统计总次数，展开模型查看各会话次数，继续展开会话查看详情。不会额外请求模型或重复计费。
            </p>
          </CardContent>
        </Card>
        <details className="rounded-xl border bg-muted/30 px-5 py-4 text-sm leading-6">
          <summary className="cursor-pointer font-medium">为什么部分调用无法核验？</summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p>
              {state?.description ??
                "本地会话通常只保留所选模型、响应 ID 和用量，缺少服务器响应中的模型字段。历史记录没有保存这个字段，就无法补出可靠结果。"}
            </p>
            {source === "codex" && (
              <p>
                使用上方“启动 Codex 并采集”，Token Lens 会读取官方后端收到的原始响应模型，并按响应
                ID 关联会话。已有的运行进程无法补开采集；普通快捷方式启动的会话仍可能缺少证据。
              </p>
            )}
            <p>这里只比较模型名称。名称相同也不能证明服务器内部运行的模型身份。</p>
          </div>
        </details>
      </div>
    </>
  );
}
