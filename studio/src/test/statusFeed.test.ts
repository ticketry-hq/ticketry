import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatusFrame, AgentStatusSnapshot } from "@worktracker/typescript-sdk";
import { dispatchStatusFrame, statusFeed } from "../features/agents/status/statusFeed";
import { useAgentStatusStore } from "../features/agents/status";
import { useTerminalStore } from "../features/agents/terminal";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { ApiError } from "../shared/api/client";
import { useToastStore } from "../app/stores/toastStore";
import type { WorkItem, WorkItemDetail } from "../shared/api/types";

const getAgentStatus = vi.fn<() => Promise<AgentStatusSnapshot>>();

vi.mock("@worktracker/typescript-sdk/agent-status", async (load) => {
  const actual = await load<typeof import("@worktracker/typescript-sdk/agent-status")>();
  return {
    ...actual,
    createAgentStatusClient: () => ({ getAgentStatus }),
  };
});

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return { ...actual, getWorkItem: vi.fn() };
});

import * as api from "../shared/api/client";
const getWorkItem = api.getWorkItem as ReturnType<typeof vi.fn>;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

const snapshot: AgentStatusSnapshot = {
  scope: { project_id: "project-1", task_id: null },
  runs: [
    {
      agent_run_id: "run-1",
      task_id: "task-1",
      module_id: "module-1",
      scope: "task",
      state: "working",
      updated_at: "2026-07-12T10:00:00Z",
    },
  ],
  automation_attempts: [],
  at: "2026-07-12T10:00:00Z",
};

const TODO = { id: "todo", name: "Todo", group: "unstarted", color: null };
const DONE = { id: "done", name: "Done", group: "completed", color: "#0a0" };

function workItem(partial: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "task-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    key: "MEML-1",
    issue_type: { id: "story", name: "Story", level: "task" },
    state: TODO,
    state_revision: 1,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-12T09:00:00Z",
    updated_at: "2026-07-12T10:00:00Z",
    ...partial,
  };
}

function detail(task: WorkItem): WorkItemDetail {
  return { task, attachments: [] };
}

beforeEach(() => {
  statusFeed.stop();
  getAgentStatus.mockReset().mockResolvedValue(snapshot);
  getWorkItem.mockReset();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  useAgentStatusStore.setState({
    projectId: null,
    runs: {},
    byTask: {},
    automationAttempts: {},
    automationByTask: {},
    workItemCursors: {},
  });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useBacklogStore.setState({
    projectId: null,
    items: [],
    states: [],
    filters: { query: "" },
    loading: false,
    error: null,
    loadError: null,
    seenStateRevisions: {},
    pendingStateDeltas: {},
  });
  useToastStore.setState({ toasts: [] });
});

describe("statusFeed", () => {
  it("hydrates through the SDK and opens one project-scoped socket", async () => {
    statusFeed.start("project-1", { refreshSnapshotOnSocketOpen: true });
    await vi.waitFor(() => expect(useAgentStatusStore.getState().runs["run-1"]).toBeDefined());
    expect(useAgentStatusStore.getState().runs["run-1"].scope).toBe("task");

    expect(getAgentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("/ws/status?project_id=project-1");

    statusFeed.stop();
    expect(FakeWebSocket.instances[0].closed).toBe(true);
  });

  it("rehydrates when the socket opens after the initial snapshot fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getAgentStatus
      .mockRejectedValueOnce(new Error("status service starting"))
      .mockResolvedValueOnce(snapshot);

    statusFeed.start("project-1", { refreshSnapshotOnSocketOpen: true });
    await vi.waitFor(() => expect(getAgentStatus).toHaveBeenCalledTimes(1));

    FakeWebSocket.instances[0].onopen?.();

    await vi.waitFor(() =>
      expect(useAgentStatusStore.getState().runs["run-1"]).toBeDefined(),
    );
    expect(getAgentStatus).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("routes lifecycle and backend frames to their owning stores", () => {
    useAgentStatusStore.getState().upsertRun(snapshot.runs[0]);
    useTerminalStore.setState({
      sessions: {
        session: {
          sessionId: "session",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          ticketSeq: null,
          status: "ready",
          transport: "ready",
          backendSession: "alive",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
          isDocChat: false,
          docRelPath: null,
          docId: null,
        },
      },
      sessionByRun: { "run-1": "session" },
    });

    dispatchStatusFrame({
      v: 1,
      type: "agent_lifecycle",
      at: "2026-07-12T10:01:00Z",
      run: { ...snapshot.runs[0], state: "needs_input", updated_at: "2026-07-12T10:01:00Z" },
    });
    dispatchStatusFrame({
      v: 1,
      type: "backend_session",
      agent_run_id: "run-1",
      status: "lost",
      at: "2026-07-12T10:02:00Z",
    } satisfies AgentStatusFrame);

    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("lost");
    expect(useTerminalStore.getState().sessions.session.backendSession).toBe("lost");
    expect(useTerminalStore.getState().sessions.session.status).toBe("session_lost");
  });

  it("moves an exited backend session into its task's resumable list", () => {
    const refreshResumable = vi.fn().mockResolvedValue(undefined);
    useTerminalStore.setState({
      sessions: {
        session: {
          sessionId: "session",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          ticketSeq: null,
          status: "ready",
          transport: "ready",
          backendSession: "alive",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
          isDocChat: false,
          docRelPath: null,
          docId: null,
        },
      },
      sessionByRun: { "run-1": "session" },
      refreshResumable,
    });

    dispatchStatusFrame({
      v: 1,
      type: "backend_session",
      agent_run_id: "run-1",
      status: "exited",
      at: "2026-07-12T10:02:00Z",
    } satisfies AgentStatusFrame);

    expect(useTerminalStore.getState().sessions.session.status).toBe("exited");
    expect(refreshResumable).toHaveBeenCalledWith(
      "task-1",
      "project-1",
      "module-1",
    );
  });

  it("drops a never-presented connecting tab when its backend session exits", () => {
    // A restore-attached tab connects only on first view; if the run exits
    // before that, the tab could never render anything but a blank pane.
    const refreshResumable = vi.fn().mockResolvedValue(undefined);
    useTerminalStore.setState({
      sessions: {
        session: {
          sessionId: "session",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          ticketSeq: null,
          status: "connecting",
          transport: "connecting",
          backendSession: "alive",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
          isDocChat: false,
          docRelPath: null,
          docId: null,
        },
      },
      sessionByRun: { "run-1": "session" },
      refreshResumable,
    });

    dispatchStatusFrame({
      v: 1,
      type: "backend_session",
      agent_run_id: "run-1",
      status: "exited",
      at: "2026-07-12T10:02:00Z",
    } satisfies AgentStatusFrame);

    expect(useTerminalStore.getState().sessions.session).toBeUndefined();
    expect(refreshResumable).toHaveBeenCalledWith(
      "task-1",
      "project-1",
      "module-1",
    );
  });

  it("routes attempt outcomes by project and clears a failure on success", () => {
    useAgentStatusStore.getState().switchProject("project-1");
    const failed = {
      attempt_id: "attempt-1",
      root_attempt_id: "attempt-1",
      retry_of_attempt_id: null,
      work_item_id: "task-1",
      status: "failed" as const,
      error: "tmux unavailable",
      agent_run_id: null,
      updated_at: "2026-07-16T10:00:00Z",
    };

    dispatchStatusFrame({
      v: 1,
      type: "automation_attempt",
      project_id: "project-1",
      attempt: failed,
    });
    expect(
      useAgentStatusStore.getState().automationAttempts["attempt-1"]?.status,
    ).toBe("failed");

    dispatchStatusFrame({
      v: 1,
      type: "automation_attempt",
      project_id: "project-2",
      attempt: { ...failed, status: "succeeded" },
    });
    expect(
      useAgentStatusStore.getState().automationAttempts["attempt-1"]?.status,
    ).toBe("failed");

    dispatchStatusFrame({
      v: 1,
      type: "automation_attempt",
      project_id: "project-1",
      attempt: {
        ...failed,
        attempt_id: "attempt-2",
        retry_of_attempt_id: "attempt-1",
        status: "succeeded",
        error: null,
        agent_run_id: "run-2",
        updated_at: "2026-07-16T10:01:00Z",
      },
    });
    expect(
      useAgentStatusStore.getState().automationAttempts["attempt-1"]?.status,
    ).toBe("succeeded");

    dispatchStatusFrame({
      v: 1,
      type: "automation_attempt",
      project_id: "project-1",
      attempt: failed,
    });
    expect(
      useAgentStatusStore.getState().automationAttempts["attempt-1"]?.status,
    ).toBe("succeeded");
  });

  it("prunes old exited runs after an authoritative snapshot", () => {
    useAgentStatusStore.getState().upsertRun({
      ...snapshot.runs[0],
      agent_run_id: "old-exit",
      state: "exited",
      updated_at: "2026-05-01T00:00:00Z",
    });

    dispatchStatusFrame({ v: 1, type: "snapshot", ...snapshot });

    expect(useAgentStatusStore.getState().runs["old-exit"]).toBeUndefined();
  });

  it("merges only a newer state delta into the matching active cached item", () => {
    const item = {
      id: "task-1",
      name: "Keep every other field",
      project_id: "project-1",
      sequence_id: 1,
      key: "MEML-1",
      issue_type: { id: "story", name: "Story", level: "task" },
      state: { id: "todo", name: "Todo", group: "unstarted", color: null },
      assignees: [], labels: [], description_html: "<p>unchanged</p>",
      description_stripped: "unchanged", description: "unchanged", parent_id: null,
      sub_issues_count: 4, blocked_by_ids: ["blocker"], blocks_ids: ["dependent"],
      created_at: "2026-07-12T09:00:00Z", updated_at: "2026-07-12T10:00:00Z",
    } satisfies WorkItem;
    useBacklogStore.setState({ projectId: "project-1", items: [item] });

    dispatchStatusFrame({
      v: 1, type: "work_item_state", project_id: "project-1", work_item_id: "task-1",
      state: { id: "done", name: "Done", group: "completed", color: "#0a0", sort_order: 7, is_protected: true },
      revision: 1,
      updated_at: "2026-07-12T10:01:00Z",
    });
    const updated = useBacklogStore.getState().items[0];
    expect(updated.state?.id).toBe("done");
    expect(updated.updated_at).toBe("2026-07-12T10:01:00Z");
    expect(updated.description_html).toBe("<p>unchanged</p>");
    expect(updated.blocked_by_ids).toEqual(["blocker"]);

    dispatchStatusFrame({
      v: 1, type: "work_item_state", project_id: "project-1", work_item_id: "task-1",
      state: { id: "todo", name: "Todo", group: "unstarted", color: null, sort_order: 0, is_protected: false },
      revision: 1,
      updated_at: "2026-07-12T10:01:00Z",
    });
    expect(useBacklogStore.getState().items[0].state?.id).toBe("done");

    dispatchStatusFrame({
      v: 1, type: "work_item_state", project_id: "project-2", work_item_id: "task-1",
      state: { id: "other", name: "Other", group: "started", color: null, sort_order: 0, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:02:00Z",
    });
    dispatchStatusFrame({
      v: 1, type: "work_item_state", project_id: "project-1", work_item_id: "unloaded",
      state: { id: "other", name: "Other", group: "started", color: null, sort_order: 0, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:02:00Z",
    });
    expect(useBacklogStore.getState().items).toHaveLength(1);
    expect(useBacklogStore.getState().items[0].state?.id).toBe("done");
  });

  it("reconnects and visibility-recovers from the in-memory cursor without a Backlog reload", () => {
    vi.useFakeTimers();
    const loadBacklog = vi.fn();
    useBacklogStore.setState({ projectId: "project-1", loadBacklog });
    statusFeed.start("project-1");
    FakeWebSocket.instances[0].onopen?.();
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "snapshot",
        ...snapshot,
        work_item_cursor: 7,
      }),
    } as MessageEvent);
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "cursor",
        project_id: "project-1",
        revision: 9,
      }),
    } as MessageEvent);
    expect(loadBacklog).not.toHaveBeenCalled();
    FakeWebSocket.instances[0].onclose?.();
    vi.advanceTimersByTime(1_300);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("cursor=9");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(FakeWebSocket.instances[2].url).toContain("cursor=9");
    expect(loadBacklog).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("requests replay when a same-project Backlog is already cached before the feed starts", async () => {
    getWorkItem.mockResolvedValue(
      detail(
        workItem({
          state: DONE,
          state_revision: 2,
          updated_at: "2026-07-12T10:01:00Z",
        }),
      ),
    );
    useBacklogStore.setState({
      projectId: "project-1",
      items: [workItem()],
      states: [TODO, DONE],
      loading: false,
    });

    statusFeed.start("project-1");

    expect(FakeWebSocket.instances[0].url).toContain("cursor=0");
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: "work_item_state",
        project_id: "project-1",
        work_item_id: "task-1",
        state: { ...DONE, sort_order: 2, is_protected: false },
        revision: 2,
        updated_at: "2026-07-12T10:01:00Z",
      }),
    } as MessageEvent);

    await vi.waitFor(() =>
      expect(useBacklogStore.getState().items[0].state?.id).toBe("done"),
    );
    expect(getWorkItem).toHaveBeenCalledTimes(1);
  });

  it("moves one Story immediately then reconciles its complete targeted detail", async () => {
    let resolveDetail!: (value: WorkItemDetail) => void;
    getWorkItem.mockReturnValue(new Promise((resolve) => { resolveDetail = resolve; }));
    useBacklogStore.setState({
      projectId: "project-1",
      items: [workItem()],
      states: [TODO, DONE],
      filters: { query: "Story" },
    });
    statusFeed.start("project-1");

    dispatchStatusFrame({
      v: 1,
      type: "work_item_state",
      project_id: "project-1",
      work_item_id: "task-1",
      state: { ...DONE, sort_order: 2, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:01:00Z",
    });

    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: { id: "done" },
      state_revision: 2,
      name: "Story",
    });
    expect(useBacklogStore.getState().filters).toEqual({ query: "Story" });
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    expect(getWorkItem).toHaveBeenCalledWith("task-1", expect.any(AbortSignal));

    resolveDetail(detail(workItem({
      state: DONE,
      state_revision: 2,
      name: "Authoritative Story",
      description_html: "<p>complete</p>",
      sub_issues_count: 5,
      updated_at: "2026-07-12T10:01:00Z",
    })));
    await vi.waitFor(() =>
      expect(useBacklogStore.getState().items[0].name).toBe("Authoritative Story"),
    );
    expect(useBacklogStore.getState().items[0]).toMatchObject({
      description_html: "<p>complete</p>",
      sub_issues_count: 5,
    });
  });

  it("deduplicates a revision and restarts immediately for a newer one", () => {
    const signals: AbortSignal[] = [];
    getWorkItem.mockImplementation((_id: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => {});
    });
    useBacklogStore.setState({ projectId: "project-1", items: [workItem()] });
    statusFeed.start("project-1");
    const frame = {
      v: 1,
      type: "work_item_state",
      project_id: "project-1",
      work_item_id: "task-1",
      state: { ...DONE, sort_order: 2, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:01:00Z",
    } as const;

    dispatchStatusFrame(frame);
    dispatchStatusFrame(frame);
    expect(getWorkItem).toHaveBeenCalledTimes(1);
    dispatchStatusFrame({
      ...frame,
      revision: 3,
      state: { ...TODO, sort_order: 1, is_protected: false },
      updated_at: "2026-07-12T10:02:00Z",
    });
    expect(signals[0].aborted).toBe(true);
    expect(getWorkItem).toHaveBeenCalledTimes(2);
  });

  it("uses one initial attempt plus at most three retries and warns without reverting", async () => {
    vi.useFakeTimers();
    getWorkItem.mockRejectedValue(new ApiError(503, "unavailable", {}));
    useBacklogStore.setState({ projectId: "project-1", items: [workItem()] });
    statusFeed.start("project-1");

    dispatchStatusFrame({
      v: 1,
      type: "work_item_state",
      project_id: "project-1",
      work_item_id: "task-1",
      state: { ...DONE, sort_order: 2, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:01:00Z",
    });
    await vi.advanceTimersByTimeAsync(1_750);
    await Promise.resolve();

    expect(getWorkItem).toHaveBeenCalledTimes(4);
    expect(useBacklogStore.getState().items[0].state?.id).toBe("done");
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain(
      "could not be fully refreshed",
    );
    vi.useRealTimers();
  });

  it("evicts a confirmed missing WorkItem without retrying", async () => {
    getWorkItem.mockRejectedValue(new ApiError(404, "not found", {}));
    useBacklogStore.setState({ projectId: "project-1", items: [workItem()] });
    statusFeed.start("project-1");

    dispatchStatusFrame({
      v: 1,
      type: "work_item_state",
      project_id: "project-1",
      work_item_id: "task-1",
      state: { ...DONE, sort_order: 2, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:01:00Z",
    });
    await vi.waitFor(() => expect(useBacklogStore.getState().items).toHaveLength(0));
    expect(getWorkItem).toHaveBeenCalledTimes(1);
  });

  it("cancels targeted reconciliation on project switch", () => {
    let signal!: AbortSignal;
    getWorkItem.mockImplementation((_id: string, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise(() => {});
    });
    useBacklogStore.setState({ projectId: "project-1", items: [workItem()] });
    statusFeed.start("project-1");
    dispatchStatusFrame({
      v: 1,
      type: "work_item_state",
      project_id: "project-1",
      work_item_id: "task-1",
      state: { ...DONE, sort_order: 2, is_protected: false },
      revision: 2,
      updated_at: "2026-07-12T10:01:00Z",
    });

    statusFeed.start("project-2");
    expect(signal.aborted).toBe(true);
  });
});
