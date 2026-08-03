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
  ApiError,
} from "../../../shared/api/client";
import { toast } from "../../../app/stores/toastStore";
import { KeyedRetryService } from "../../../shared/async/keyedRetry";
import { scratchBucketId, useTerminalStore } from "../terminal";
import { SCRATCH_RUN_TASK_ID } from "../types";
import {
  useBacklogStore,
} from "../../work-items";
import { useTicketWorkspaceStore } from "../../../app/shell/ticket-workspace/selected-ticket/state/ticketWorkspaceStore";
import { useIssueStore } from "../../work-items/issueStore";
import { useTasksStore } from "../../studio/stores/tasksStore";
import { synchronizeActiveStateCatalogs } from "../../workflows/stateCatalogSync";
import { useWorkflowEditorStore } from "../../workflows/workflowEditorStore";
import type { DesignDoc } from "../types";
import { useAgentStatusStore } from "./store";
import { statusWebSocketUrl } from "../../../runtime";
import { loadWorkItemDetail } from "../../work-items/queries";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 15_000;
const DETAIL_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 250,
  backoffMultiplier: 2,
} as const;
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
    routeWorkItemStateFrame(frame);
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

function routeWorkItemStateFrame(frame: WorkItemStateFrame): void {
  // The socket is project-scoped, but this second guard rejects a queued frame
  // after project switch and makes direct dispatch safe in tests.
  if (active && active.projectId !== frame.project_id) return;
  // Revision ordering belongs to the record owner. Compatibility projections
  // are updated below only while they still exist; they do not decide whether
  // this frame is current.
  const owner = useIssueStore.getState();
  const cached = owner.getWorkItem(frame.work_item_id);
  // An id is globally unique, so a cached record for another project is
  // proof that this frame belongs to a stale socket scope. Do not let that
  // frame mutate the canonical record (or every id-derived surface).
  let accepted = !cached || cached.project_id === frame.project_id
    ? owner.applyWorkItemStateDelta(
        frame.work_item_id,
        frame.state,
        frame.revision,
        frame.updated_at,
      )
    : false;
  const backlog = useBacklogStore.getState();
  if (backlog.projectId === frame.project_id) {
    accepted = backlog.applyStateDelta(
      frame.work_item_id,
      frame.state,
      frame.revision,
      frame.updated_at,
    ) || accepted;
  }
  const tasks = useTasksStore.getState();
  if (tasks.selectedProjectId === frame.project_id) {
    accepted = tasks.applyWorkItemStateDelta(
      frame.work_item_id,
      frame.state,
      frame.revision,
    ) || accepted;
  }
  if (accepted) active?.reconcileWorkItem(frame);
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
  reconcileWorkItem: (frame: WorkItemStateFrame) => void;
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
    const cachedBacklog = useBacklogStore.getState();
    const rememberedCursor = useAgentStatusStore.getState().workItemCursors[projectId];
    let workItemCursor =
      rememberedCursor !== undefined
        ? rememberedCursor
        : cachedBacklog.projectId === projectId && !cachedBacklog.loading
          ? 0
          : undefined;
    let snapshotRequest: object | null = null;
    const detailRetries = new KeyedRetryService<string, number, void>();

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
      useAgentStatusStore.getState().acceptWorkItemCursor(projectId, workItemCursor);
    };

    const reconcileWorkItem = (frame: WorkItemStateFrame) => {
      if (frame.project_id !== projectId || stopped) return;
      void detailRetries
        .schedule(
          frame.work_item_id,
          frame.revision,
          async (signal) => {
            let detail;
            try {
              detail = await loadWorkItemDetail(frame.work_item_id, signal);
            } catch (error) {
              if (error instanceof ApiError && error.status === 404) {
              if (!stopped && active?.projectId === projectId) {
                  useIssueStore
                    .getState()
                    .removeReconciledWorkItem(frame.work_item_id, frame.revision);
                  useBacklogStore
                    .getState()
                    .removeReconciledItem(frame.work_item_id, frame.revision);
                  useTasksStore
                    .getState()
                    .removeReconciledTask(frame.work_item_id, frame.revision);
                }
                return;
              }
              throw error;
            }
            if (stopped || signal.aborted || active?.projectId !== projectId) return;
            let stale = false;
            stale =
              useIssueStore.getState().reconcileWorkItem(detail.task, frame.revision) ===
              "stale";
            const backlog = useBacklogStore.getState();
            if (backlog.projectId === projectId) {
              stale =
                backlog.reconcileTargetedItem(detail.task, frame.revision) ===
                "stale" || stale;
            }
            const tasks = useTasksStore.getState();
            if (tasks.selectedProjectId === projectId) {
              stale =
                tasks.reconcileTargetedTask(detail.task, frame.revision) ===
                  "stale" || stale;
            }
            if (stale) {
              throw new Error(
                `WorkItem ${frame.work_item_id} detail is older than revision ${frame.revision}`,
              );
            }
          },
          DETAIL_RETRY_OPTIONS,
        )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (stopped || active?.projectId !== projectId) return;
          toast.error(
            `Story ${frame.work_item_id} moved, but its details could not be fully refreshed.`,
          );
        });
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
      detailRetries.cancelAll();
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
      reconcileWorkItem,
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
