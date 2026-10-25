import { CalendarClock, Monitor, Moon, Server, Sun, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ThemePreference } from "@/hooks/use-theme";
import type { Scope } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ScopeCounts {
  total: number;
  running: number;
  failed: number;
}

interface SidebarProps {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  counts: Record<Scope, ScopeCounts>;
  onNewTimer: () => void;
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
}

const SCOPES: { id: Scope; label: string; icon: typeof Server; hint: string }[] = [
  { id: "system", label: "System Units", icon: Server, hint: "Actions require authentication" },
  { id: "user", label: "User Units", icon: User, hint: "Your session's systemd --user" },
];

export function Sidebar({ scope, onScopeChange, counts, onNewTimer, theme, onThemeChange }: SidebarProps) {
  return (
    <aside className="bg-sidebar flex w-56 shrink-0 flex-col gap-1 border-r p-2">
      <div className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">Scope</div>
      {SCOPES.map(({ id, label, icon: Icon, hint }) => {
        const c = counts[id];
        const active = scope === id;
        return (
          <button
            key={id}
            onClick={() => onScopeChange(id)}
            title={hint}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
              active ? "bg-primary/12 text-foreground" : "hover:bg-accent text-foreground/80",
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} />
            <span className="flex-1 font-medium">{label}</span>
            {c.failed > 0 && (
              <span className="bg-destructive rounded-full px-1.5 text-[11px] font-semibold text-white">{c.failed}</span>
            )}
            <span className="text-muted-foreground text-xs tabular-nums">{c.total}</span>
          </button>
        );
      })}

      <div className="text-muted-foreground mt-3 px-2 text-xs">
        {counts[scope].running} running · {counts[scope].failed} failed
      </div>

      <div className="mt-auto flex flex-col gap-2 p-1">
        <Button onClick={onNewTimer} className="w-full">
          <CalendarClock />
          New Timer from Cron
        </Button>
        <div className="bg-muted flex rounded-md p-0.5" role="radiogroup" aria-label="Theme">
          {(
            [
              ["system", Monitor, "Follow desktop"],
              ["light", Sun, "Light"],
              ["dark", Moon, "Dark"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={theme === id}
              title={label}
              onClick={() => onThemeChange(id)}
              className={cn(
                "flex flex-1 items-center justify-center rounded py-1",
                theme === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
