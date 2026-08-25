import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/error-reporting";

/**
 * 顶层错误边界。
 *
 * 必须有的理由：React 渲染期间抛出的异常不会触发 window.onerror，
 * 没有边界时整棵树会被卸载，用户看到的就是纯白窗口——既不知道出了什么事，
 * 也不知道能做什么。此前这种情况日志里一片空白。
 *
 * 现在改为：显示一句人话 + 错误摘要 + 两个可操作按钮，同时把错误写进本地日志。
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // componentStack 指明是哪个组件炸的，比单看堆栈好定位
    reportError(`react-render${info.componentStack ?? ""}`, error);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-lg space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <div className="font-display text-lg font-medium">界面出错了</div>
          <p className="text-sm text-muted-foreground">
            这次渲染失败了，不影响已保存的配置与数据。错误详情已记入本地日志，
            可在「设置 → 诊断日志」查看或导出。
          </p>
          {/* 摘要直接摆出来：多数用户不会去翻日志文件，但会截图 */}
          <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-3 text-xs break-all whitespace-pre-wrap">
            {error.name}: {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={() => void window.tokenLens?.revealLogFile()}
              className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              打开日志文件
            </button>
          </div>
        </div>
      </div>
    );
  }
}
