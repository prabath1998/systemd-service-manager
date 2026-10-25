import { ScrollText } from "lucide-react";

import { StatusLabel } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TimerInfo } from "@/lib/types";
import { formatDate, formatRelative } from "@/lib/utils";

interface TimersTableProps {
  timers: TimerInfo[];
  onViewLogs: (timer: TimerInfo) => void;
}

export function TimersTable({ timers, onViewLogs }: TimersTableProps) {
  if (timers.length === 0) {
    return <div className="text-muted-foreground flex h-40 items-center justify-center">No timers match the current filters.</div>;
  }
  // Soonest first; timers with no scheduled elapse go last.
  const sorted = [...timers].sort((a, b) => (a.next_elapse_ms ?? Infinity) - (b.next_elapse_ms ?? Infinity) || a.name.localeCompare(b.name));
  const now = Date.now();

  return (
    <Table>
      <TableHeader className="bg-background sticky top-0 z-10">
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">Timer</TableHead>
          <TableHead>Activates</TableHead>
          <TableHead>Next execution</TableHead>
          <TableHead>Last triggered</TableHead>
          <TableHead>Schedule</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="pr-4 text-right">Logs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((t) => (
          <TableRow key={`${t.scope}:${t.name}`}>
            <TableCell className="pl-4" title={t.description}>
              <div className="font-mono text-[13px]">{t.name}</div>
              <div className="text-muted-foreground max-w-72 truncate text-xs">{t.description}</div>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">{t.unit}</TableCell>
            <TableCell>
              <div>{formatDate(t.next_elapse_ms)}</div>
              <div className="text-muted-foreground text-xs">{formatRelative(t.next_elapse_ms, now)}</div>
            </TableCell>
            <TableCell>
              <div>{formatDate(t.last_trigger_ms)}</div>
              <div className="text-muted-foreground text-xs">{formatRelative(t.last_trigger_ms, now)}</div>
            </TableCell>
            <TableCell>
              <div className="flex max-w-80 flex-wrap gap-1">
                {t.on_calendar.map((c) => (
                  <Badge key={c} variant="secondary" className="font-mono">
                    {c}
                  </Badge>
                ))}
                {t.monotonic.map((m) => (
                  <Badge key={m} variant="outline" className="font-mono">
                    {m}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <StatusLabel activeState={t.active_state} />
            </TableCell>
            <TableCell className="pr-4 text-right">
              <Button variant="ghost" size="icon-sm" title={`View logs for ${t.unit}`} onClick={() => onViewLogs(t)}>
                <ScrollText />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
