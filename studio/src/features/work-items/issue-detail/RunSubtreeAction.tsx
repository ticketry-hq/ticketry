import { useEffect, useRef, useState } from "react";
import { toast } from "../../../app/stores/toastStore";
import { ApiError, apiErrorMessage } from "../../../shared/api/client";
import { TEMP_TASK_ID } from "../../agents/types";
import { executeTaskSubtree } from "../../studio/lib/api";
import { useSettingsStore } from "../../settings/store";
import { useIssueStore } from "./internal/issueStore";

interface RunSubtreeActionProps {
  task: {
    id: string;
    project_id: string;
    parent_id: string | null;
    sub_issues_count: number;
    state?: { id: string | null; name?: string | null } | null;
    issue_type: { id: string; name: string };
  };
  moduleId: string | null;
}

/** Starts an eligible top-level work item's existing dependency-subtree campaign. */
export function RunSubtreeAction({ task, moduleId }: RunSubtreeActionProps) {
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);
  const capabilityProjectId = useSettingsStore((state) => state.projectId);
  const capabilityMap = useSettingsStore(
    (state) => state.subtreeRunCapabilities,
  );
  // One row per work item mounts this, so they share a single request rather
  // than each firing its own (and each retrying after a failure).
  const ensureSettings = useSettingsStore((state) => state.ensureSettings);
  useEffect(() => {
    void ensureSettings(task.project_id);
  }, [ensureSettings, task.project_id]);

  const enabledStates = capabilityProjectId === task.project_id
    ? capabilityMap[task.issue_type.id]
    : undefined;
  const eligible =
    task.id !== TEMP_TASK_ID &&
    moduleId !== null &&
    task.parent_id === moduleId &&
    task.sub_issues_count > 0 &&
    task.state?.id !== null &&
    task.state?.id !== undefined &&
    enabledStates?.includes(task.state.id) === true;

  if (!eligible) return null;

  async function runSubtree(): Promise<void> {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setPending(true);
    try {
      await executeTaskSubtree(task.id);
      toast.success("Subtree run started.");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body &&
        typeof error.body === "object" &&
        (error.body as Record<string, unknown>).error === "subtree_run_not_enabled"
      ) {
        const [, refreshedIssue] = await Promise.all([
          useSettingsStore.getState().refreshSubtreeRunCapabilities(task.project_id),
          useIssueStore.getState().reloadIssue(task.id),
        ]);
        const stateName = refreshedIssue?.task.state?.name ?? task.state?.name;
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
