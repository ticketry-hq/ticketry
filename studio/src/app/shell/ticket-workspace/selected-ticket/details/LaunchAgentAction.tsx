import { useRef, useState } from "react";
import { createAgentStatusClient } from "@worktracker/typescript-sdk/agent-status";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { toast } from "../../../../../state/clientStore";
import {
  agentApiBase,
  apiErrorMessage,
  apiKey,
} from "../../../../../shared/api/client";
import { IconPlay } from "../../../../../shared/ui/icons";

function launchErrorMessage(error: unknown): string {
  if (error instanceof WorkTrackerApiError) {
    const body = error.body;
    if (body && typeof body === "object") {
      const code = (body as { error?: unknown }).error;
      if (typeof code === "string" && code) {
        return code.replace(/_/g, " ");
      }
    }
  }
  return apiErrorMessage(error);
}

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
      toast.error(`Agent run could not be started: ${launchErrorMessage(error)}`);
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
      className="flex-none rounded border border-pane-border p-1.5 text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      <IconPlay size={14} />
    </button>
  );
}
