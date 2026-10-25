import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X, Activity } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function WindowButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "bg-foreground/8 text-foreground/80 hover:bg-foreground/15 flex size-6 items-center justify-center rounded-full transition-colors",
        danger && "hover:bg-destructive hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

/** GNOME/libadwaita-style header bar for the frameless window. */
export function TitleBar({ failedCount }: { failedCount: number }) {
  const win = getCurrentWindow();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => win.isMaximized().then(setMaximized).catch(() => {}));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [win]);

  return (
    <header data-tauri-drag-region className="bg-titlebar flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <div data-tauri-drag-region className="pointer-events-none flex items-center gap-2">
        <Activity className="text-primary size-4" />
        <span className="font-semibold">Systemd Dashboard</span>
      </div>
      <div data-tauri-drag-region className="flex flex-1 justify-center">
        {failedCount > 0 && (
          <span className="bg-destructive/10 text-destructive flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
            <span className="bg-destructive size-1.5 rounded-full" />
            {failedCount} failed {failedCount === 1 ? "unit" : "units"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <WindowButton label="Minimize" onClick={() => win.minimize()}>
          <Minus className="size-3.5" />
        </WindowButton>
        <WindowButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? <Copy className="size-3" /> : <Square className="size-3" />}
        </WindowButton>
        <WindowButton label="Close" onClick={() => api.closeMainWindow()} danger>
          <X className="size-3.5" />
        </WindowButton>
      </div>
    </header>
  );
}
