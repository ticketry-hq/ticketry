import { useRef, useState } from "react";
import { toast } from "../../../../../state/clientStore";
import { ApiError, apiErrorMessage } from "../../../../../shared/api/client";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import { executeTaskSubtree } from "../../../../../shared/api/client";
import {
  refreshSubtreeRunCapabilities,
  useSubtreeRunCapabilitiesQuery,
} from "../../../../../features/settings";
import { queryClient } from "../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../shared/query/keys";
import type { WorkItem } from "../../../../../shared/api/types";

interface RunSubtreeActionProps {
  task: WorkItem;
  moduleId: string | null;
}

/** Starts an eligible top-level work item's existing dependency-subtree campaign. */
export function RunSubtreeAction({ task, moduleId }: RunSubtreeActionProps) {
  const item = task as unknown as {
    id: string;
    project_id: string;
    parent_id: string | null;
    sub_issues_count: number;
    state?: { id: string | null; name?: string | null } | null;
    issue_type: { id: string; name: string };
  };
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);
  // One row per work item mounts this; the query dedups so they share a single
  // request rather than each firing its own.
  const { data: capabilityMap } = useSubtreeRunCapabilitiesQuery(
    item.project_id,
  );
  const enabledStates = capabilityMap?.[item.issue_type.id];
  const eligible =
    item.id !== TEMP_TASK_ID &&
    moduleId !== null &&
    item.parent_id === moduleId &&
    item.sub_issues_count > 0 &&
    item.state?.id !== null &&
    item.state?.id !== undefined &&
    enabledStates?.includes(item.state.id) === true;

  if (!eligible) return null;

  async function runSubtree(): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    try {
      await executeTaskSubtree(item.id);
      toast.success("Subtree run started.");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body &&
        typeof error.body === "object" &&
        (error.body as Record<string, unknown>).error === "subtree_run_not_enabled"
      ) {
        await Promise.all([
          refreshSubtreeRunCapabilities(item.project_id),
          queryClient.invalidateQueries({
            queryKey: queryKeys.workItems.byId(item.id),
            exact: true,
          }),
        ]);
        const stateName = queryClient.getQueryData<WorkItem>(
          queryKeys.workItems.byId(item.id),
        )?.state?.name ?? item.state?.name;
        toast.error(
          stateName
            ? `Run subtree is no longer available while this item is in ${stateName}.`
            : "Run subtree is no longer available in this item's current state.",
        );
      } else {
        toast.error(`Subtree execution could not be started: ${apiErrorMessage(error)}`);
      }
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      aria-label="Run subtree"
      aria-busy={pending}
      disabled={pending}
      onClick={() => void runSubtree()}
      className="rounded border border-pane-border px-2 py-1 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Running…" : "Run subtree"}
    </button>
  );
}
