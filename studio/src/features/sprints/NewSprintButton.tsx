import { useEffect, useRef, useState } from "react";
import type { PlanningSprint } from "../planning-graph";
import type { CreateSprintOutcome } from "./sprintCreation";

export default function NewSprintButton({ sprints, onCreate, onCreated }: {
  sprints: PlanningSprint[];
  onCreate: (name: string) => Promise<CreateSprintOutcome>;
  onCreated?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<Extract<CreateSprintOutcome, { kind: "refreshFailed" }> | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function close() {
    if (pending.current) return;
    setOpen(false);
    setError(null);
    setCommitted(null);
  }
  async function submit() {
    if (pending.current || !name.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome: CreateSprintOutcome = committed
        ? (await committed.refresh(), { kind: "created", id: committed.id }) : await onCreate(name.trim());
      if (!mounted.current) return;
      switch (outcome.kind) {
        case "created": setOpen(false); setCommitted(null); onCreated?.(outcome.id); break;
        case "refreshFailed": setCommitted(outcome); setError(outcome.message); break;
        case "missing": setError("Sprint could not be created. Try again."); break;
        default: { const exhaustive: never = outcome; return exhaustive; }
      }
    } catch (cause) {
      if (!mounted.current) return;
      const message = cause instanceof Error ? cause.message : "Try again.";
      setError(committed ? `Sprint created, but the view could not refresh: ${message}` : message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (!open) return <button type="button" onClick={() => {
    const largest = sprints.reduce((max, sprint) => {
      const match = /^Sprint (\d+)$/.exec(sprint.name);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    setName(`Sprint ${largest + 1}`);
    setOpen(true);
  }} className="h-7 px-2 text-sm font-semibold text-focus-accent hover:bg-pane-title"><span aria-hidden="true">+ </span>New sprint</button>;
  return <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void submit(); }} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <input autoFocus aria-label="Sprint name" value={name} disabled={busy || committed !== null} onChange={(event) => setName(event.target.value)} className="h-7 border border-pane-border bg-pane-bg px-2 text-sm text-text-primary outline-none focus:border-focus-accent" />
    <button type="submit" disabled={busy || !name.trim()} className="h-7 border border-focus-accent bg-pane-title px-2 text-sm font-semibold text-focus-accent disabled:opacity-50">{busy ? committed ? "Refreshing…" : "Creating…" : committed ? "Retry refresh" : "Create"}</button>
    <button type="button" disabled={busy} onClick={close} className="h-7 px-2 text-sm text-text-muted">Cancel</button>
    {error && <p role="alert" className="w-full text-sm text-lifecycle-danger">{error}</p>}
  </form>;
}
