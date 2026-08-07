import {
  type AgentStatusFrame,
  type StatusDocumentFrame,
  type WorkItemStateFrame,
  type WorkflowStateFrame,
} from "@worktracker/typescript-sdk/agent-status";
import { useClientStore } from "../../../state/clientStore";
import { scratchBucketId, useTerminalStore } from "../terminal";
import { SCRATCH_RUN_TASK_ID } from "../types";
import { useClientStore as useTicketWorkspaceStore } from "../../../state/clientStore";
import { useWorkflowEditorStore } from "../../workflows/workflowEditorStore";
import type { DesignDoc } from "../types";
import { useAgentStatusStore } from "./store";
import { statusWebSocketUrl } from "../../../runtime";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import {
  getStatesSnapshot,
  setStatesSorted,
  upsertState,
} from "../../../shared/query/stateCatalog";
import { advanceStateCatalogRevision } from "../../../shared/stateCatalogRevision";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 15_000;
const WORK_ITEM_INVALIDATION_WINDOW_MS = 50;
const EXITED_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

function pruneExitedRuns(at: string): void {
  const cutoff = new Date(Date.parse(at) - EXITED_RUN_RETENTION_MS).toISOString();
  useAgentStatusStore.getState().pruneRuns(cutoff);
}

function dispatch(frame: AgentStatusFrame): void {
  const runs = useAgentStatusStore.getState();
  if (frame.type === "snapshot") {
    // A project switch closes the previous socket asynchronously. A final
    // queued snapshot from that socket must never reconcile the newly selected
    // project's runs as absent (and therefore exited).
    if (runs.projectId !== frame.scope.project_id) return;
    if (frame.work_item_cursor !== undefined) {
      active?.acceptCursor(frame.scope.project_id, frame.work_item_cursor);
    }
    if (frame.workflow_states !== undefined) {
      routeWorkflowStateSnapshot(
        frame.scope.project_id,
        frame.workflow_states,
      );
    }
    runs.reconcileScope(frame.scope, frame.runs, frame.at);
    runs.reconcileAutomationAttempts(frame.automation_attempts);
    pruneExitedRuns(frame.at);
    return;
  }
  if (frame.type === "agent_lifecycle") {
    if (frame.run.project_id && runs.projectId !== frame.run.project_id) return;
    runs.upsertRun(frame.run);
    return;
  }
  if (frame.type === "backend_session") {
    const sessions = useTerminalStore.getState();
    const sessionId = sessions.sessionByRun[frame.agent_run_id];
    if (sessionId) {
      if (frame.status === "lost") sessions.setSessionLost(sessionId);
      else sessions.setExited(sessionId);
    }
    runs.applyState(
      frame.agent_run_id,
      frame.status === "lost" ? "lost" : "exited",
      frame.at,
    );
    return;
  }
  if (frame.type === "work_item_state") {
    active?.acceptWorkItemFrame(frame);
    return;
  }
  if (frame.type === "workflow_state") {
    routeWorkflowStateFrame(frame);
    return;
  }
  if (frame.type === "cursor") {
    active?.acceptCursor(frame.project_id, frame.revision);
    return;
  }
  if (frame.type === "automation_attempt") {
    if (active && active.projectId !== frame.project_id) return;
    if (runs.projectId !== frame.project_id) return;
    runs.upsertAutomationAttempt(frame.attempt);
    return;
  }
  routeDocumentFrame(frame as StatusDocumentFrame);
}

function routeWorkflowStateFrame(frame: WorkflowStateFrame): void {
  if (active && active.projectId !== frame.project_id) return;
  advanceStateCatalogRevision(frame.project_id, frame.state);
  const states = upsertState(frame.project_id, frame.state);
  const editor = useWorkflowEditorStore.getState();
  if (editor.projectId === frame.project_id) {
    useWorkflowEditorStore.setState({ states });
  }
}

function routeWorkflowStateSnapshot(
  projectId: string,
  states: WorkflowStateFrame["state"][],
): void {
  if (active && active.projectId !== projectId) return;
  advanceStateCatalogRevision(projectId, states);
  setStatesSorted(projectId, states);
  const editor = useWorkflowEditorStore.getState();
  if (editor.projectId === projectId) {
    useWorkflowEditorStore.setState({
      states: getStatesSnapshot(projectId),
    });
  }
}

function routeDocumentFrame(frame: StatusDocumentFrame): void {
  const { task_id: taskId, doc, event } = frame;
  if (!taskId || !doc?.id || !doc.rel_path) return;
  // A scratch run's documents land in its module's scratch bucket, not one
  // shared bucket — otherwise modules would swap each other's doc tabs.
  const bucket =
    taskId === SCRATCH_RUN_TASK_ID
      ? scratchBucketId(frame.module_id ?? "")
      : taskId;
  const workspace = useTicketWorkspaceStore.getState();
  workspace.ensureWorkspace(bucket);
  const designDoc: DesignDoc = {
    id: doc.id,
    rel_path: doc.rel_path,
    label: typeof doc.label === "string" ? doc.label : doc.rel_path,
  };
  const registryKey = taskId === SCRATCH_RUN_TASK_ID
    ? queryKeys.documents.registry("scratch", frame.module_id ?? "", null, frame.module_id)
    : queryKeys.documents.registry(
        "task",
        taskId,
        active?.projectId,
        frame.module_id,
      );
  queryClient.setQueryData<{ documents: DesignDoc[] }>(registryKey, (current) => {
    const documents = current?.documents ?? [];
    const existing = documents.findIndex((item) => item.rel_path === designDoc.rel_path);
    if (existing < 0) return { documents: [...documents, designDoc] };
    return {
      documents: documents.map((item, index) => index === existing ? designDoc : item),
    };
  });
  workspace.openDoc(bucket, designDoc.id, event === "created");
}

function socketUrl(projectId: string, cursor?: number): string {
  const url = new URL(statusWebSocketUrl(), window.location.href);
  url.searchParams.set("project_id", projectId);
  if (cursor !== undefined) url.searchParams.set("cursor", String(cursor));
  return url.toString();
}

interface StatusFeedOptions {
  refreshSnapshotOnSocketOpen?: boolean;
}

let active: {
  projectId: string;
  refreshSnapshotOnSocketOpen: boolean;
  acceptCursor: (projectId: string, revision: number) => void;
  acceptWorkItemFrame: (frame: WorkItemStateFrame) => void;
  stop: () => void;
} | null = null;

export const statusFeed = {
  start(projectId: string, options: StatusFeedOptions = {}): void {
    const refreshSnapshotOnSocketOpen =
      options.refreshSnapshotOnSocketOpen ?? false;
    if (
      active?.projectId === projectId &&
      active.refreshSnapshotOnSocketOpen === refreshSnapshotOnSocketOpen
    ) {
      return;
    }
    active?.stop();
    useAgentStatusStore.getState().switchProject(projectId);

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    let workItemCursor =
      useClientStore.getState().workItemCursorsByProject[projectId];
    const pendingWorkItemIds = new Set<string>();
    let invalidationTimer: ReturnType<typeof setTimeout> | null = null;

    const acceptCursor = (frameProjectId: string, revision: number) => {
      if (frameProjectId !== projectId || !Number.isSafeInteger(revision)) return;
      workItemCursor = Math.max(workItemCursor ?? 0, revision);
      useClientStore
        .getState()
        .advanceWorkItemCursor(projectId, workItemCursor);
    };

    const flushWorkItemInvalidations = () => {
      invalidationTimer = null;
      const ids = [...pendingWorkItemIds];
      pendingWorkItemIds.clear();
      const refreshMembership = pendingMembershipRefresh;
      pendingMembershipRefresh = false;
      for (const id of ids) {
        // The mutation's own settle invalidation is authoritative. Refetching
        // while its optimistic value is visible could paint an older external
        // value over the person's in-flight edit.
        const locallyMutating = queryClient.isMutating({
          predicate: (mutation) =>
            (mutation.state.variables as { id?: unknown } | undefined)?.id === id,
        });
        if (locallyMutating > 0) continue;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.workItems.byId(id),
          exact: true,
        });
      }
      if (refreshMembership) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.all,
        });
      }
    };

    let pendingMembershipRefresh = false;

    const acceptWorkItemFrame = (frame: WorkItemStateFrame) => {
      if (frame.project_id !== projectId || stopped) return;
      acceptCursor(frame.project_id, frame.revision);
      pendingWorkItemIds.add(frame.work_item_id);
      pendingMembershipRefresh ||= frame.membership_changed === true;
      invalidationTimer ??= setTimeout(
        flushWorkItemInvalidations,
        WORK_ITEM_INVALIDATION_WINDOW_MS,
      );
    };

    const connect = () => {
      if (stopped) return;
      const next = new WebSocket(socketUrl(projectId, workItemCursor));
      socket = next;
      next.onopen = () => {
        attempt = 0;
      };
      next.onmessage = (event: MessageEvent) => {
        // close() does not discard messages already queued by the browser.
        // Only the currently owned socket may write into the project store.
        if (stopped || socket !== next) return;
        if (typeof event.data !== "string") return;
        try {
          const frame = JSON.parse(event.data) as AgentStatusFrame;
          if (frame.v === 1) dispatch(frame);
        } catch {
          /* Ignore malformed or unsupported frames. */
        }
      };
      next.onclose = () => {
        if (stopped || socket !== next) return;
        socket = null;
        const base = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempt++);
        retry = setTimeout(connect, base + Math.random() * base * 0.25);
      };
      next.onerror = () => {};
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      const previous = socket;
      socket = null;
      previous?.close();
      connect();
    };
    document.addEventListener("visibilitychange", onVisibility);
    connect();

    const stop = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      pendingWorkItemIds.clear();
      if (invalidationTimer) clearTimeout(invalidationTimer);
      if (retry) clearTimeout(retry);
      const previous = socket;
      socket = null;
      previous?.close();
      if (active?.stop === stop) active = null;
    };
    active = {
      projectId,
      refreshSnapshotOnSocketOpen,
      acceptCursor,
      acceptWorkItemFrame,
      stop,
    };
  },

  stop(): void {
    active?.stop();
  },
};

export { dispatch as dispatchStatusFrame };

// Vite preserves Zustand state across Fast Refresh, but module-scoped socket
// handles are replaced. Close the old connection so the replacement can resume
// from the cursor retained in the status store instead of silently baselining
// over cached rows.
if (import.meta.hot) {
  import.meta.hot.dispose(() => statusFeed.stop());
}
