import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PAGE_SHORTCUTS } from "@/lib/shortcuts";

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>输入框里打字时这些键不会触发。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between gap-4">
            <span className="text-muted-foreground">刷新全部服务</span>
            <kbd className="rounded border bg-white/50 px-1.5 font-mono text-xs">F5</kbd>
          </li>
          {PAGE_SHORTCUTS.map((s) => (
            <li key={s.key} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="rounded border bg-white/50 px-1.5 font-mono text-xs">Alt+{s.key}</kbd>
            </li>
          ))}
          <li className="flex justify-between gap-4">
            <span className="text-muted-foreground">命令面板（↑↓ 选择）</span>
            <kbd className="rounded border bg-white/50 px-1.5 font-mono text-xs">Ctrl+K</kbd>
          </li>
          <li className="flex justify-between gap-4">
            <span className="text-muted-foreground">打开本说明</span>
            <kbd className="rounded border bg-white/50 px-1.5 font-mono text-xs">F1 或 ?</kbd>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
