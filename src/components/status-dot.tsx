import { cn } from "@/lib/utils";

export type UnitStatus = "running" | "failed" | "transitioning" | "inactive";

export function unitStatus(activeState: string): UnitStatus {
  switch (activeState) {
    case "active":
    case "reloading":
      return "running";
    case "failed":
      return "failed";
    case "activating":
    case "deactivating":
      return "transitioning";
    default:
      return "inactive";
  }
}

const COLORS: Record<UnitStatus, string> = {
  running: "bg-success",
  failed: "bg-destructive",
  transitioning: "bg-warning animate-pulse",
  inactive: "bg-muted-foreground/50",
};

export function StatusDot({ activeState, className }: { activeState: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", COLORS[unitStatus(activeState)], className)} />;
}

export function StatusLabel({ activeState }: { activeState: string }) {
  const status = unitStatus(activeState);
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", status === "failed" && "text-destructive")}>
      <StatusDot activeState={activeState} />
      {activeState}
    </span>
  );
}
