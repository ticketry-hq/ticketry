import { useRef, useState } from "react";
import { toast } from "../../../../../../state/clientStore";
import { ApiError, apiErrorMessage, executeTaskSubtree } from "../../../../../../shared/api/client";
import { TEMP_TASK_ID } from "../../../../../../features/agents/types";
import {
  refreshSubtreeRunCapabilities,
  useSubtreeRunCapabilitiesQuery,
} from "../../../../../../features/settings";
import { queryClient } from "../../../../../../shared/query/queryClient";
import { queryKeys } from "../../../../../../shared/query/keys";
import type { GraphRunExecutionMode, WorkItem } from "../../../../../../shared/api/types";
import { stateById, useCachedStates } from "../../../../../../shared/query/stateCatalog";

/**
 * Reports whether the one subtree-run capability authorizes campaigns for this
 * work item. Both the parallel and the serial action share this single gate, so
 * a stale capability refresh removes them together.
 */
export function useSubtreeRunEligibility(item: WorkItem, moduleId: string | null): boolean {
  // One row per work item mounts this; the query dedups so they share a single
  // request rather than each firing its own.
  const { data: capabilityMap } = useSubtreeRunCapabilitiesQuery(item.project_id);
  const enabledStates = capabilityMap?.[item.issue_type];
  return (
    item.id !== TEMP_TASK_ID &&
    moduleId !== null &&
    item.parent_id === moduleId &&
    item.sub_issues_count > 0 &&
    item.state !== null &&
    enabledStates?.includes(item.state) === true
  );
}

interface SubtreeRunLaunch {
  /** True while this control's own request is in flight. */
  pending: boolean;
  launch: () => void;
}

interface SubtreeRunLaunchOptions {
  item: WorkItem;
  /** Omitted mode keeps the historical parallel campaign. */
  mode?: GraphRunExecutionMode;
  /** The action's accessible name, reused in stale-capability feedback. */
  actionName: string;
  successMessage: string;
  /** Reported when the press was accepted but launched no work item. */
  inertMessage: string;
  failureMessage: string;
}

/**
 * Arms one graph-run campaign for a single control. Each control owns its own
 * in-flight guard so a submitted request cannot be duplicated from it, and
 * neither control blocks the other. Both controls share this reading of the
 * response, so an accepted press that started nothing reads the same either
 * way.
 */
export function useSubtreeRunLaunch({
  item,
  mode,
  actionName,
  successMessage,
  inertMessage,
  failureMessage,
}: SubtreeRunLaunchOptions): SubtreeRunLaunch {
  const states = useCachedStates(item.project_id);
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);

  async function run(): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    try {
      // The campaign accepts the press either way; only the launched list says
      // whether any work actually started.
      const result = await executeTaskSubtree(item.id, mode);
      if (result.launched.length > 0) {
        toast.success(successMessage);
      } else {
        toast.error(inertMessage);
      }
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
        const stateId = queryClient.getQueryData<WorkItem>(
          queryKeys.workItems.byId(item.id),
        )?.state ?? item.state;
        const stateName = stateById(states, stateId)?.name;
        toast.error(
          stateName
            ? `${actionName} is no longer available while this item is in ${stateName}.`
            : `${actionName} is no longer available in this item's current state.`,
        );
      } else {
        toast.error(`${failureMessage}: ${apiErrorMessage(error)}`);
      }
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  }

  return { pending, launch: () => void run() };
}
