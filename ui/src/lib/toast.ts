export type ToastKind = "ok" | "err";

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(items);
}

export function showToast(message: string, kind: ToastKind = "ok"): void {
  const id = ++seq;
  items = [...items, { id, message, kind }].slice(-4);
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 3200);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(items);
  return () => {
    listeners.delete(fn);
  };
}
