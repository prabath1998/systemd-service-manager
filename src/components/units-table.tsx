import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, Play, RotateCw, ScrollText, Square } from "lucide-react";

import { StatusLabel, unitStatus } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SystemdUnit, UnitAction } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

type SortKey = "name" | "description" | "active_state" | "sub_state" | "memory_bytes";

const STATE_ORDER: Record<string, number> = { failed: 0, activating: 1, deactivating: 1, reloading: 1, active: 2, inactive: 3 };

interface UnitsTableProps {
  units: SystemdUnit[];
  pending: Set<string>;
  onAction: (unit: SystemdUnit, action: UnitAction) => void;
  onViewLogs: (unit: SystemdUnit) => void;
}

export const unitKey = (u: Pick<SystemdUnit, "scope" | "name">) => `${u.scope}:${u.name}`;

export function UnitsTable({ units, pending, onAction, onViewLogs }: UnitsTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });

  const sorted = useMemo(() => {
    const cmp = (a: SystemdUnit, b: SystemdUnit): number => {
      switch (sort.key) {
        case "memory_bytes":
          return (a.memory_bytes ?? -1) - (b.memory_bytes ?? -1);
        case "active_state":
          return (STATE_ORDER[a.active_state] ?? 9) - (STATE_ORDER[b.active_state] ?? 9) || a.name.localeCompare(b.name);
        default:
          return a[sort.key].localeCompare(b[sort.key]) || a.name.localeCompare(b.name);
      }
    };
    const out = [...units].sort(cmp);
    return sort.desc ? out.reverse() : out;
  }, [units, sort]);

  const header = (key: SortKey, label: string, className?: string) => {
    const Icon = sort.key !== key ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp;
    return (
      <TableHead className={className} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button
          className="hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))}
        >
          {label}
          <Icon className={cn("size-3", sort.key !== key && "opacity-40")} />
        </button>
      </TableHead>
    );
  };

  if (units.length === 0) {
    return <div className="text-muted-foreground flex h-40 items-center justify-center">No units match the current filters.</div>;
  }

  return (
    <Table>
      <TableHeader className="bg-background sticky top-0 z-10">
        <TableRow className="hover:bg-transparent">
          {header("name", "Unit", "pl-4")}
          {header("description", "Description")}
          {header("active_state", "Active")}
          {header("sub_state", "Sub-state")}
          {header("memory_bytes", "Memory", "text-right")}
          <TableHead>Enabled</TableHead>
          <TableHead className="pr-4 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((u) => {
          const key = unitKey(u);
          const busy = pending.has(key);
          const running = unitStatus(u.active_state) === "running";
          const toggleable = u.unit_file_state === "enabled" || u.unit_file_state === "disabled";
          return (
            <TableRow key={key} className={cn(u.active_state === "failed" && "bg-destructive/5")}>
              <TableCell className="max-w-72 truncate pl-4 font-mono text-[13px]" title={u.name}>
                {u.name}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-96 truncate" title={u.description}>
                {u.description || <span className="italic opacity-60">{u.load_state}</span>}
              </TableCell>
              <TableCell>
                <StatusLabel activeState={u.active_state} />
              </TableCell>
              <TableCell className="text-muted-foreground">{u.sub_state}</TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">{formatBytes(u.memory_bytes)}</TableCell>
              <TableCell>
                {toggleable ? (
                  <Switch
                    checked={u.unit_file_state === "enabled"}
                    disabled={busy}
                    onCheckedChange={(on) => onAction(u, on ? "enable" : "disable")}
                    aria-label={`Enable ${u.name} at boot`}
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">{u.unit_file_state ?? "—"}</span>
                )}
              </TableCell>
              <TableCell className="pr-4">
                <div className="flex items-center justify-end gap-0.5">
                  {busy && <Loader2 className="text-muted-foreground mr-1 size-4 animate-spin" />}
                  {running ? (
                    <Button variant="ghost" size="icon-sm" title="Stop" disabled={busy} onClick={() => onAction(u, "stop")}>
                      <Square />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon-sm" title="Start" disabled={busy} onClick={() => onAction(u, "start")}>
                      <Play />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon-sm" title="Restart" disabled={busy} onClick={() => onAction(u, "restart")}>
                    <RotateCw />
                  </Button>
                  <Button variant="ghost" size="icon-sm" title="View logs" onClick={() => onViewLogs(u)}>
                    <ScrollText />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
