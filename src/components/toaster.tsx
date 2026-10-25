import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  kind: "success" | "error";
  title: string;
  detail?: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: Toast["kind"], title: string, detail?: string) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, title, detail }];
  emit();
  window.setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4000);
}

export const toast = {
  success: (title: string, detail?: string) => push("success", title, detail),
  error: (title: string, detail?: string) => push("error", title, detail),
};

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-96 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className="bg-popover text-popover-foreground animate-in slide-in-from-bottom-2 pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg"
        >
          {t.kind === "success" ? (
            <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t.title}</div>
            {t.detail && <div className={cn("text-muted-foreground mt-0.5 text-xs break-words select-text")}>{t.detail}</div>}
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
