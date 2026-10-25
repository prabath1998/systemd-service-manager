import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, CalendarClock, Loader2, Save } from "lucide-react";

import { toast } from "@/components/toaster";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage } from "@/lib/api";
import type { GeneratedTimer, TimerRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; cron: string }[] = [
  { label: "Every 5 min", cron: "*/5 * * * *" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Daily 02:00", cron: "0 2 * * *" },
  { label: "Weekdays 09:00", cron: "0 9 * * 1-5" },
  { label: "Weekly (Sun)", cron: "0 0 * * 0" },
  { label: "Monthly", cron: "0 0 1 * *" },
  { label: "At login", cron: "@reboot" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  );
}

function CodePreview({ name, content }: { name: string; content: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground font-mono text-xs">~/.config/systemd/user/{name}</div>
      <pre className="bg-muted overflow-x-auto rounded-md border p-3 font-mono text-xs leading-5">{content}</pre>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function TimerGeneratorDialog({ open, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState<TimerRequest>({ cron: "0 2 * * *", unit_name: "", exec_path: "", description: "" });
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<GeneratedTimer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Placeholder values let the preview render before the user fills in every field.
  const request: TimerRequest = {
    ...form,
    unit_name: form.unit_name.trim() || "my-job",
    exec_path: form.exec_path.trim() || "/usr/local/bin/my-job.sh",
  };
  const complete = form.unit_name.trim() !== "" && form.exec_path.trim() !== "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      api
        .generateTimer(request)
        .then((g) => !cancelled && (setPreview(g), setError(null)))
        .catch((e) => !cancelled && setError(errorMessage(e)));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request.cron, request.unit_name, request.exec_path, request.description]);

  const set = (key: keyof TimerRequest) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const dir = await api.saveUserTimer(form, overwrite);
      toast.success(`${preview?.timer_name} enabled and started`, `Files written to ${dir}`);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not save timer", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="text-primary size-5" />
            New Timer from Cron
          </DialogTitle>
          <DialogDescription>
            Converts a cron schedule into a systemd user <code>.service</code> + <code>.timer</code> pair.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="flex flex-col gap-4">
            <Field label="Cron expression" hint="minute hour day-of-month month day-of-week — or @hourly, @daily, @reboot…">
              <Input value={form.cron} onChange={set("cron")} className="font-mono" spellCheck={false} aria-invalid={!!error && /field|cron|range|step|macro/i.test(error)} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.cron}
                  size="sm"
                  variant={form.cron.trim() === p.cron ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setForm((f) => ({ ...f, cron: p.cron }))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Field label="Unit name" hint="Creates <name>.service and <name>.timer">
              <Input value={form.unit_name} onChange={set("unit_name")} placeholder="nightly-backup" className="font-mono" spellCheck={false} />
            </Field>
            <Field label="Command" hint="Absolute path to the executable, followed by any arguments">
              <Input value={form.exec_path} onChange={set("exec_path")} placeholder="/home/me/bin/backup.sh --full" className="font-mono" spellCheck={false} />
            </Field>
            <Field label="Description (optional)">
              <Input value={form.description} onChange={set("description")} placeholder="Nightly backup of ~/Documents" />
            </Field>

            <Card className="gap-2 py-3">
              <CardHeader>
                <CardTitle className="text-sm">Upcoming runs</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground font-mono text-xs leading-5">
                {preview?.next_runs.length ? (
                  preview.next_runs.map((r) => <div key={r}>{r}</div>)
                ) : (
                  <div>{preview?.on_calendar.length === 0 ? "1 minute after the user session starts" : "—"}</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            {error && (
              <div className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-2.5 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
            <Tabs defaultValue="timer" className={cn("min-h-0 flex-1", error && "opacity-50")}>
              <TabsList>
                <TabsTrigger value="timer">{preview?.timer_name ?? "timer"}</TabsTrigger>
                <TabsTrigger value="service">{preview?.service_name ?? "service"}</TabsTrigger>
              </TabsList>
              <ScrollArea className="max-h-[50vh]">
                <TabsContent value="timer">{preview && <CodePreview name={preview.timer_name} content={preview.timer_content} />}</TabsContent>
                <TabsContent value="service">{preview && <CodePreview name={preview.service_name} content={preview.service_content} />}</TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="items-center">
          <label className="text-muted-foreground mr-auto flex items-center gap-2 text-sm">
            <Switch checked={overwrite} onCheckedChange={setOverwrite} />
            Overwrite existing unit files
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!complete || !!error || saving} title={complete ? undefined : "Enter a unit name and command first"}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save &amp; Enable Timer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
