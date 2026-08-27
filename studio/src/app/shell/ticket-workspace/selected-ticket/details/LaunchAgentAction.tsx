import { useRef, useState } from "react";
import { toast } from "../../../../../state/clientStore";
import {
  launchDefaultAgent,
  launchFailureMessage,
} from "../../../../../features/agents/terminal";
import { IconPlay } from "../../../../../shared/ui/icons";

/** Starts one task-scoped run using the work item's current-state binding. */
export function LaunchAgentAction({
  issueId,
  projectId,
  moduleId,
}: {
  issueId: string;
  projectId: string | null;
  moduleId: string | null;
}) {
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);

  async function launchAgent(): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    try {
      const context = projectId && moduleId ? { projectId, moduleId } : undefined;
      await launchDefaultAgent(issueId, context);
      toast.success("Agent run started.");
    } catch (error) {
      toast.error(`Agent run could not be started: ${launchFailureMessage(error)}`);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      aria-label="Run agent"
      aria-busy={pending}
      title="Run agent"
      disabled={pending}
      onClick={() => void launchAgent()}
      className="flex-none border border-pane-border p-1.5 text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      <IconPlay size={14} />
    </button>
  );
}
