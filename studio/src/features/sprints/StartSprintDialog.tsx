import { useRef, useState } from "react";
import { ModalSurface as ModalShell } from "../../shared/ui/ModalSurface";
import type { PlanningSprint } from "../planning-graph";

export default function StartSprintDialog({ sprint, activeSprintName, onStart, onClose }: {
  sprint: PlanningSprint;
  activeSprintName: string | null;
  onStart: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  function close() { if (!pending.current) onClose(); }
  async function start() {
    if (pending.current || activeSprintName !== null) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (await onStart()) onClose();
      else setError("Sprint could not be started. Try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sprint could not be started. Try again.");
    } finally { pending.current = false; setBusy(false); }
  }
  return <ModalShell title={`Start ${sprint.name}`} width="w-[48ch] max-w-[calc(100vw-32px)]" onClose={close}>
    <p className="text-sm text-text-secondary">{activeSprintName !== null ? `Complete ${activeSprintName} before starting another sprint.` : "Start this sprint? Only one sprint can be active in this project."}</p>
    {error && <p role="alert" className="mt-3 text-sm text-lifecycle-danger">{error}</p>}
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={close} className="px-3 py-1 text-sm text-text-muted">Cancel</button>
      <button type="button" disabled={busy || activeSprintName !== null} onClick={() => void start()} className="border border-focus-accent bg-pane-title px-3 py-1 text-sm font-semibold text-focus-accent disabled:opacity-50">{busy ? "Starting…" : "Start sprint"}</button>
    </div>
  </ModalShell>;
}
