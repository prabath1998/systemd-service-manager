import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";

import { LogSheet, type LogTarget } from "@/components/log-sheet";
import { Sidebar, type ScopeCounts } from "@/components/sidebar";
import { unitStatus, type UnitStatus } from "@/components/status-dot";
import { TimerGeneratorDialog } from "@/components/timer-generator-dialog";
import { TimersTable } from "@/components/timers-table";
import { TitleBar } from "@/components/title-bar";
import { Toaster, toast } from "@/components/toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnitsTable, unitKey } from "@/components/units-table";
import { usePolling } from "@/hooks/use-polling";
import { useTheme } from "@/hooks/use-theme";
import { api, errorMessage, onFailedCount } from "@/lib/api";
import type { Scope, SystemdUnit, UnitAction } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusFilter = "Running" | "Failed" | "Stopped";
type TypeFilter = "Services" | "Timers";

const STATUS_MATCH: Record<StatusFilter, UnitStatus[]> = {
  Running: ["running", "transitioning"],
  Failed: ["failed"],
  Stopped: ["inactive"],
};
const TYPE_MATCH: Record<TypeFilter, string> = { Services: "service", Timers: "timer" };

const PAST_TENSE: Record<UnitAction, string> = {
  start: "started",
  stop: "stopped",
  restart: "restarted",
  enable: "enabled",
  disable: "disabled",
};

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
}

export default function App() {
  const theme = useTheme();
  const [scope, setScope] = useState<Scope>("system");
  const [tab, setTab] = useState<"units" | "timers">("units");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<StatusFilter>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<TypeFilter>>(new Set(["Services"]));
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Both scopes are fetched together so the sidebar and title bar can show failure counts.
  const units = usePolling(() => api.getUnits(), 5000);
  const timers = usePolling(() => api.getTimers(scope), 15000, [scope]);

  // The tray monitor emits when the number of failed units changes; refresh promptly.
  const refreshUnits = units.refresh;
  useEffect(() => {
    const unlisten = onFailedCount(() => refreshUnits());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshUnits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === "f") || (e.key === "/" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F5" || (e.ctrlKey && e.key === "r")) {
        e.preventDefault();
        units.refresh();
        timers.refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [units, timers]);

  const counts = useMemo(() => {
    const c: Record<Scope, ScopeCounts> = {
      system: { total: 0, running: 0, failed: 0 },
      user: { total: 0, running: 0, failed: 0 },
    };
    for (const u of units.data ?? []) {
      const s = c[u.scope];
      s.total++;
      const status = unitStatus(u.active_state);
      if (status === "running") s.running++;
      if (status === "failed") s.failed++;
    }
    return c;
  }, [units.data]);

  const needle = query.trim().toLowerCase();
  const matchesStatus = useCallback(
    (activeState: string) =>
      statusFilter.size === 0 || [...statusFilter].some((f) => STATUS_MATCH[f].includes(unitStatus(activeState))),
    [statusFilter],
  );

  const visibleUnits = useMemo(
    () =>
      (units.data ?? []).filter(
        (u) =>
          u.scope === scope &&
          (typeFilter.size === 0 || [...typeFilter].some((t) => TYPE_MATCH[t] === u.unit_type)) &&
          matchesStatus(u.active_state) &&
          (!needle || u.name.toLowerCase().includes(needle) || u.description.toLowerCase().includes(needle)),
      ),
    [units.data, scope, typeFilter, matchesStatus, needle],
  );

  const visibleTimers = useMemo(
    () =>
      (timers.data ?? []).filter(
        (t) =>
          t.scope === scope &&
          matchesStatus(t.active_state) &&
          (!needle || [t.name, t.unit, t.description, ...t.on_calendar].some((s) => s.toLowerCase().includes(needle))),
      ),
    [timers.data, scope, matchesStatus, needle],
  );

  const runAction = async (unit: SystemdUnit, action: UnitAction) => {
    const key = unitKey(unit);
    setPending((p) => new Set(p).add(key));
    try {
      await api.controlUnit(unit.name, action, unit.scope);
      toast.success(`${unit.name} ${PAST_TENSE[action]}`);
    } catch (e) {
      toast.error(`Could not ${action} ${unit.name}`, errorMessage(e));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
      // Jobs complete asynchronously; give systemd a moment before re-reading state.
      window.setTimeout(() => {
        units.refresh();
        timers.refresh();
      }, 600);
    }
  };

  const error = tab === "units" ? units.error : timers.error;
  const loading = units.loading || timers.loading;

  return (
    <div className="flex h-full flex-col">
      <TitleBar failedCount={counts.system.failed + counts.user.failed} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          scope={scope}
          onScopeChange={setScope}
          counts={counts}
          onNewTimer={() => setGeneratorOpen(true)}
          theme={theme.preference}
          onThemeChange={theme.setPreference}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-h-0 flex-1 gap-0">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
              <TabsList>
                <TabsTrigger value="units">Services</TabsTrigger>
                <TabsTrigger value="timers">Timers</TabsTrigger>
              </TabsList>
              <div className="relative w-72">
                <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                <Input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  placeholder="Search units…  (Ctrl+F)"
                  className="h-8 pl-8"
                  spellCheck={false}
                />
              </div>
              <div className="flex items-center gap-1.5">
                {(["Running", "Failed", "Stopped"] as StatusFilter[]).map((f) => (
                  <FilterBadge key={f} active={statusFilter.has(f)} onClick={() => setStatusFilter((s) => toggle(s, f))}>
                    {f}
                  </FilterBadge>
                ))}
                {tab === "units" && (
                  <>
                    <div className="bg-border mx-1 h-4 w-px" />
                    {(["Services", "Timers"] as TypeFilter[]).map((f) => (
                      <FilterBadge key={f} active={typeFilter.has(f)} onClick={() => setTypeFilter((s) => toggle(s, f))}>
                        {f}
                      </FilterBadge>
                    ))}
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground text-xs tabular-nums">
                  {tab === "units" ? visibleUnits.length : visibleTimers.length} shown
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Refresh (F5)"
                  onClick={() => {
                    units.refresh();
                    timers.refresh();
                  }}
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                </Button>
              </div>
            </div>

            {error && (
              <div className="bg-destructive/10 text-destructive flex items-center gap-2 border-b px-4 py-2 text-sm">
                <AlertTriangle className="size-4" />
                {error}
              </div>
            )}

            <TabsContent value="units" className="min-h-0">
              <ScrollArea className="h-full">
                {units.data === null && !units.error ? (
                  <div className="text-muted-foreground flex h-40 items-center justify-center">Loading units…</div>
                ) : (
                  <UnitsTable
                    units={visibleUnits}
                    pending={pending}
                    onAction={runAction}
                    onViewLogs={(u) => setLogTarget({ name: u.name, scope: u.scope })}
                  />
                )}
              </ScrollArea>
            </TabsContent>
            <TabsContent value="timers" className="min-h-0">
              <ScrollArea className="h-full">
                {timers.data === null && !timers.error ? (
                  <div className="text-muted-foreground flex h-40 items-center justify-center">Loading timers…</div>
                ) : (
                  <TimersTable timers={visibleTimers} onViewLogs={(t) => setLogTarget({ name: t.unit || t.name, scope: t.scope })} />
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <LogSheet target={logTarget} onClose={() => setLogTarget(null)} />
      <TimerGeneratorDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        onSaved={() => {
          setScope("user");
          setTab("timers");
          units.refresh();
          timers.refresh();
        }}
      />
      <Toaster />
    </div>
  );
}

function FilterBadge({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} aria-pressed={active}>
      <Badge variant={active ? "default" : "outline"} className={cn("cursor-pointer px-2.5 py-1", !active && "hover:bg-accent")}>
        {children}
      </Badge>
    </button>
  );
}
