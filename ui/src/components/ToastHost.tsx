import { useEffect, useState } from "react";
import { subscribeToasts, type ToastItem } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-72 flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur-xl",
            t.kind === "err"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-white/50 bg-popover text-foreground",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
