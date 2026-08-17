import { useRef, useState } from "react";
import { createAgentStatusClient } from "@worktracker/typescript-sdk/agent-status";
import { toast } from "../../../../../state/clientStore";
import { agentApiBase, apiKey } from "../../../../../shared/api/client";
import { launchFailureMessage } from "../../../../../features/agents/terminal";
import { IconPlay } from "../../../../../shared/ui/icons";

/** Starts one task-scoped run using the work item's current-state binding. */
export function LaunchAgentAction({ issueId }: { issueId: string }) {
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);

  async function launchAgent(): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    try {
      const client = createAgentStatusClient({
        baseUrl: agentApiBase(),
        apiKey: apiKey(),
      });
      await client.launchAgent({ issueId });
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
