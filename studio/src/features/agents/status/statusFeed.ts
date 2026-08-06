import {
  createAgentStatusClient,
  type AgentStatusFrame,
  type StatusDocumentFrame,
  type WorkItemStateFrame,
  type WorkflowStateFrame,
} from "@worktracker/typescript-sdk/agent-status";
import {
  agentApiBase,
  apiKey,
} from "../../../shared/api/client";
import { useClientStore } from "../../../state/clientStore";
import { scratchBucketId, useTerminalStore } from "../terminal";
import { SCRATCH_RUN_TASK_ID } from "../types";
import { useTicketWorkspaceStore } from "../../../app/shell/ticket-workspace/selected-ticket/state/ticketWorkspaceStore";
import { synchronizeActiveStateCatalogs } from "../../workflows/stateCatalogSync";
import { useWorkflowEditorStore } from "../../workflows/workflowEditorStore";
import type { DesignDoc } from "../types";
import { useAgentStatusStore } from "./store";
import { statusWebSocketUrl } from "../../../runtime";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

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
    runs.upsertRun(frame.run);
    return;
  }
  if (frame.type === "backend_session") {
    const sessions = useTerminalStore.getState();
    const sessionId = sessions.sessionByRun[frame.agent_run_id];
    if (sessionId) {
      if (frame.status === "lost") sessions.setSessionLost(sessionId);
      else sessions.setBackendSession(sessionId, "exited");
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
  const editor = useWorkflowEditorStore.getState();
  const editorStates =
    editor.projectId === frame.project_id ? editor.states : [];
  const synchronized = synchronizeActiveStateCatalogs(
    frame.project_id,
    frame.state,
    editorStates,
  );
  if (editor.projectId === frame.project_id) {
    useWorkflowEditorStore.setState({ states: synchronized });
  }
}

function routeWorkflowStateSnapshot(
  projectId: string,
  states: WorkflowStateFrame["state"][],
): void {
  if (active && active.projectId !== projectId) return;
  const editor = useWorkflowEditorStore.getState();
  let editorStates = editor.projectId === projectId ? editor.states : [];
  for (const state of states) {
    editorStates = synchronizeActiveStateCatalogs(
      projectId,
      state,
      editorStates,
    );
  }
  if (editor.projectId === projectId) {
    useWorkflowEditorStore.setState({ states: editorStates });
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
  workspace.upsertDoc(bucket, designDoc, event === "updated" ? "updated" : "created");
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

    const client = createAgentStatusClient({
      baseUrl: agentApiBase(),
      apiKey: apiKey(),
    });
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    let workItemCursor =
      useClientStore.getState().workItemCursorsByProject[projectId];
    let snapshotRequest: object | null = null;
    const pendingWorkItemIds = new Set<string>();
    let invalidationTimer: ReturnType<typeof setTimeout> | null = null;

    const snapshot = () => {
      const request = {};
      snapshotRequest = request;
      const queryKey = queryKeys.agentStatus.byProject(projectId);
      void queryClient.cancelQueries({ queryKey, exact: true }).then(() =>
        queryClient.fetchQuery({
          queryKey,
          queryFn: ({ signal }) => client.getAgentStatus({ projectId, signal }),
          staleTime: 0,
        }),
      )
        .then((body) => {
          // An abort only rejects an in-flight request; a response that has
          // already resolved would still dispatch after stop() or a project
          // switch. Gate on being the live controller of the live feed.
          if (stopped || snapshotRequest !== request) return;
          if (active?.projectId !== projectId) return;
          dispatch({ v: 1, type: "snapshot", ...body });
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("[statusFeed] snapshot failed", error);
          }
        });
    };

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
      for (const id of ids) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.workItems.byId(id),
          exact: true,
        });
      }
      if (ids.length > 0) {
        // The unchanged protocol's work_item_state frame is structural: a
        // state change can move an id between rendered membership sections.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.all,
        });
      }
    };

    const acceptWorkItemFrame = (frame: WorkItemStateFrame) => {
      if (frame.project_id !== projectId || stopped) return;
      acceptCursor(frame.project_id, frame.revision);
      pendingWorkItemIds.add(frame.work_item_id);
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
        if (refreshSnapshotOnSocketOpen) snapshot();
      };
      next.onmessage = (event: MessageEvent) => {
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
      snapshot();
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
    snapshot();
    connect();

    const stop = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      snapshotRequest = null;
      void queryClient.cancelQueries({
        queryKey: queryKeys.agentStatus.byProject(projectId),
        exact: true,
      });
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
