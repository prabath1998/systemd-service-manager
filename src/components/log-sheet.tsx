import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Pause, Play } from "lucide-react";

import { toast } from "@/components/toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, onLogLine, onLogStreamEnded } from "@/lib/api";
import type { LogEntry, Scope } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

export interface LogTarget {
  name: string;
  scope: Scope;
}

type Severity = "ERROR" | "WARN" | "INFO";
const SEVERITIES: Severity[] = ["ERROR", "WARN", "INFO"];
const MAX_LINES = 5000;

/** journald priorities: 0-3 emerg..err, 4 warning, 5-7 notice/info/debug. */
function severity(priority: number): Severity {
  if (priority <= 3) return "ERROR";
  if (priority === 4) return "WARN";
  return "INFO";
}

const SEVERITY_STYLE: Record<Severity, string> = {
  ERROR: "text-destructive",
  WARN: "text-warning",
  INFO: "",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  ERROR: "data-[on=true]:bg-destructive data-[on=true]:text-white",
  WARN: "data-[on=true]:bg-warning data-[on=true]:text-black",
  INFO: "data-[on=true]:bg-foreground data-[on=true]:text-background",
};

export function LogSheet({ target, onClose }: { target: LogTarget | null; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [ended, setEnded] = useState(false);
  const [filters, setFilters] = useState<Record<Severity, boolean>>({ ERROR: true, WARN: true, INFO: true });

  const viewportRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Lines arriving while paused (or between animation frames) are held here, then flushed.
  const pendingRef = useRef<LogEntry[]>([]);

  useEffect(() => {
    if (!target) return;
    const streamId = crypto.randomUUID();
    let frame = 0;
    setEntries([]);
    setEnded(false);
    setPaused(false);
    pendingRef.current = [];

    const flush = () => {
      frame = 0;
      if (pausedRef.current || pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setEntries((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };

    const unlistenLine = onLogLine((e) => {
      if (e.stream_id !== streamId) return;
      pendingRef.current.push(e);
      if (pendingRef.current.length > MAX_LINES) pendingRef.current.splice(0, pendingRef.current.length - MAX_LINES);
      if (!frame) frame = requestAnimationFrame(flush);
    });
    const unlistenEnd = onLogStreamEnded((id) => id === streamId && setEnded(true));

    // Subscribe before starting the stream so the initial backlog is not missed.
    Promise.all([unlistenLine, unlistenEnd])
      .then(() => api.streamLogs(streamId, target.name, target.scope))
      .catch((e) => toast.error("Could not stream logs", errorMessage(e)));

    return () => {
      cancelAnimationFrame(frame);
      api.stopLogs(streamId).catch(() => {});
      unlistenLine.then((fn) => fn());
      unlistenEnd.then((fn) => fn());
    };
  }, [target]);

  // Resuming flushes whatever was buffered while paused.
  useEffect(() => {
    if (!paused && pendingRef.current.length) {
      const batch = pendingRef.current;
      pendingRef.current = [];
      setEntries((prev) => prev.concat(batch).slice(-MAX_LINES));
    }
  }, [paused]);

  const visible = useMemo(() => entries.filter((e) => filters[severity(e.priority)]), [entries, filters]);

  useEffect(() => {
    const el = viewportRef.current;
    if (autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [visible, autoScroll]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { ERROR: 0, WARN: 0, INFO: 0 };
    for (const e of entries) c[severity(e.priority)]++;
    return c;
  }, [entries]);

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(960px,92vw)] gap-0 sm:max-w-none">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="font-mono">{target?.name}</SheetTitle>
          <SheetDescription>
            journalctl {target?.scope === "user" ? "--user " : ""}-u {target?.name} -f
            {ended && " · stream ended"}
          </SheetDescription>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant={paused ? "default" : "outline"} onClick={() => setPaused((p) => !p)}>
              {paused ? <Play /> : <Pause />}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEntries([])}>
              <Eraser />
              Clear
            </Button>
            <div className="bg-border mx-1 h-5 w-px" />
            {SEVERITIES.map((s) => (
              <button key={s} onClick={() => setFilters((f) => ({ ...f, [s]: !f[s] }))} aria-pressed={filters[s]}>
                <Badge variant="outline" data-on={filters[s]} className={cn("cursor-pointer gap-1.5 tabular-nums", SEVERITY_BADGE[s])}>
                  {s}
                  <span className="opacity-70">{counts[s]}</span>
                </Badge>
              </button>
            ))}
            <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
              Auto-scroll
              <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
            </label>
          </div>
        </SheetHeader>
        <ScrollArea
          className="min-h-0 flex-1 bg-black/[0.03] dark:bg-black/25"
          viewportRef={viewportRef}
          onViewportScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            if (!atBottom && autoScroll) setAutoScroll(false);
          }}
        >
          <div className="p-3 font-mono text-xs leading-5 select-text">
            {visible.length === 0 && <div className="text-muted-foreground p-4 text-center">{ended ? "No log entries." : "Waiting for log entries…"}</div>}
            {visible.map((e, i) => {
              const sev = severity(e.priority);
              return (
                <div key={i} className={cn("flex gap-3 whitespace-pre-wrap", SEVERITY_STYLE[sev])}>
                  <span className="text-muted-foreground shrink-0 tabular-nums">{formatTime(e.timestamp_ms)}</span>
                  <span className="text-muted-foreground w-28 shrink-0 truncate" title={`${e.identifier ?? ""}[${e.pid ?? ""}]`}>
                    {e.identifier}
                    {e.pid && `[${e.pid}]`}
                  </span>
                  <span className="min-w-0 break-words">{e.message}</span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <div className="text-muted-foreground flex justify-between border-t px-4 py-1.5 text-xs">
          <span>
            {visible.length} of {entries.length} lines
          </span>
          {paused && <span className="text-warning">Paused — new lines are buffered until you resume</span>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
