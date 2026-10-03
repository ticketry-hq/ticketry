import { useRef, useState } from "react";
import { ModalSurface as ModalShell } from "../../shared/ui/ModalSurface";
import type { PlanningSprint } from "../planning-graph";

export default function CompleteSprintDialog({ sprint, done, total, plannedSprints, onComplete, onClose }: {
  sprint: PlanningSprint;
  done: number;
  total: number;
  plannedSprints: PlanningSprint[];
  onComplete: (carryoverSprintId: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const unfinished = total - done;
  const targets = plannedSprints.filter((planned) => planned.status === "planned" && planned.id !== sprint.id);
  function close() { if (!pending.current) onClose(); }
  async function complete() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const destination = unfinished > 0 && targets.some((planned) => planned.id === target) ? target : null;
    try {
      if (await onComplete(destination)) onClose();
      else setError("Sprint could not be completed. Try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sprint could not be completed. Try again.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <ModalShell title={`Complete ${sprint.name}`} width="w-[48ch] max-w-[calc(100vw-32px)]" onClose={close}>
    <p className="text-sm text-text-secondary">{done} done · {unfinished} unfinished</p>
    {unfinished > 0 ? <label className="mt-3 block text-sm text-text-secondary">
      Move {unfinished} unfinished item{unfinished === 1 ? "" : "s"} to
      <select value={targets.some((planned) => planned.id === target) ? target : ""} disabled={busy} onChange={(event) => setTarget(event.target.value)} className="mt-2 block h-7 w-full border border-pane-border bg-pane-bg px-2 text-sm text-text-primary">
        <option value="">Backlog</option>
        {targets.map((planned) => <option key={planned.id} value={planned.id}>{planned.name}</option>)}
      </select>
    </label> : <p className="mt-3 text-sm text-text-muted">Everything in this sprint is done.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-lifecycle-danger">{error}</p>}
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={close} className="px-3 py-1 text-sm text-text-muted">Cancel</button>
      <button type="button" disabled={busy} onClick={() => void complete()} className="border border-focus-accent bg-pane-title px-3 py-1 text-sm font-semibold text-focus-accent disabled:opacity-50">{busy ? "Completing…" : "Complete sprint"}</button>
    </div>
  </ModalShell>;
}
