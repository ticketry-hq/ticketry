import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { AgentStateBadge } from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status";
import { dispatchStatusFrame } from "../features/agents/status/statusFeed";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { deriveTaskSessions } from "../features/agents/terminal/hooks";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const terminalApi = vi.hoisted(() => ({
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
  resumeTerminal: vi.fn(),
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket, active }: { bucket: string; active: boolean }) => (
      <div data-testid="selected-ticket-terminal" data-active={String(active)}>{bucket}</div>
    ),
  }),
);

function session(
  sessionId: string,
  taskId: string,
  agentRunId: string,
  status: SessionMeta["status"] = "ready",
): SessionMeta {
  return {
    sessionId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    ticketSeq: 1,
    status,
    transport: status === "ready" ? "ready" : "closed",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId,
  };
}

function run(
  agentRunId: string,
  taskId: string,
  state: "working" | "exited" | "lost" = "working",
) {
  return {
    agent_run_id: agentRunId,
    task_id: taskId,
    module_id: "module-1",
    scope: "task" as const,
    state,
    started_at: "2026-08-07T12:00:00Z",
    updated_at: "2026-08-07T12:00:00Z",
  };
}

describe("overhaul acceptance — terminals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    queryClient.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: "story-1",
      focusedPane: "tasks",
      sidebarVisible: true,
      storySearchQuery: "",
      collapsedStateIds: new Set(["todo"]),
      expandedIdsByModule: {},
      workspaces: {},
      activeByTask: {},
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
  });

  it("[overhaul-09] keeps an externally killed terminal tab and presents it as dead", () => {
    // The kill is confirmed by the pushed run projection (reconciliation
    // publishes "lost"); the viewer's own session_lost verdict alone must
    // not outrank a projection that still reports the run alive.
    const meta = session("session-1", "story-1", "run-1", "session_lost");
    const tabs = deriveTaskSessions(
      "story-1",
      { "session-1": meta },
      { "run-1": run("run-1", "story-1", "lost") },
      new Set(),
    );

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: "session-1", lifecycle: "lost" });
  });

  it("defers to a live run projection over a stale viewer verdict", () => {
    const meta = session("session-1", "story-1", "run-1", "session_lost");
    const tabs = deriveTaskSessions(
      "story-1",
      { "session-1": meta },
      { "run-1": run("run-1", "story-1", "working") },
      new Set(),
    );

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: "session-1", lifecycle: "working" });
  });

  it("[overhaul-10] keeps a closed terminal dismissed across a server refetch", () => {
    const meta = session("session-1", "story-1", "run-1");
    const persisted = {
      agent_run_id: "run-1",
      created_at: "2026-08-07T12:00:00Z",
    };
    useTerminalStore.setState({
      sessions: { "session-1": meta },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": run("run-1", "story-1") } });

    useTerminalStore.getState().closeTab("session-1");
    useTerminalStore.getState().restoreLiveSessions("story-1", [persisted]);

    expect(useTerminalStore.getState().sessions).toEqual({});
  });

  it("[overhaul-15] keeps a connected run live when an old project's snapshot arrives", () => {
    const meta = session("session-1", "story-1", "run-1");
    const liveRun = {
      ...run("run-1", "story-1"),
      project_id: "project-1",
      agent: "codex",
    };
    useTerminalStore.setState({
      sessions: { "session-1": meta },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": liveRun } });

    dispatchStatusFrame({
      v: 1,
      type: "snapshot",
      scope: { project_id: "previous-project", task_id: null },
      runs: [],
      automation_attempts: [],
      at: "2026-08-07T12:01:00Z",
    });

    const tabs = deriveTaskSessions(
      "story-1",
      useTerminalStore.getState().sessions,
      useAgentStatusStore.getState().runs,
      new Set(),
    );
    expect(tabs[0]).toMatchObject({ id: "session-1", lifecycle: "working" });
  });

  it("[overhaul-36] clears a false exited terminal and work-item lifecycle together", async () => {
    const meta = session("session-1", "story-1", "run-1");
    const exitedRun = {
      ...run("run-1", "story-1", "exited"),
      project_id: "project-1",
      agent: "codex" as const,
      updated_at: "2026-08-07T12:05:00Z",
    };
    useTerminalStore.setState({
      sessions: { "session-1": meta },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": exitedRun } });

    render(
      <QueryClientProvider client={queryClient}>
        <AgentStateBadge issueId="story-1" />
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          ticketSeq={1}
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "T-1 · codex" }))
      .toContainElement(screen.getByLabelText("Agent session has exited"));
    expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();

    const workingSnapshot = (updatedAt: string) => ({
      v: 1 as const,
      type: "snapshot" as const,
      scope: { project_id: "project-1", task_id: null },
      runs: [{ ...exitedRun, state: "working" as const, updated_at: updatedAt }],
      automation_attempts: [],
      at: updatedAt,
    });

    act(() => {
      // A replayed active *delta* cannot revive a run after a real terminal
      // event: at equal timestamps the terminal record retains precedence.
      dispatchStatusFrame({
        v: 1,
        type: "agent_lifecycle",
        at: exitedRun.updated_at,
        run: { ...exitedRun, state: "working" },
      });
    });
    expect(screen.getByLabelText("Agent session has exited")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();

    act(() => {
      // A snapshot is authoritative for liveness even without a newer stamp:
      // a quiet run keeps its last hook timestamp, so a repaired snapshot
      // must recover every presentation derived from the shared status-feed
      // holding without recreating the tab.
      dispatchStatusFrame(workingSnapshot(exitedRun.updated_at));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent session has exited"))
        .not.toBeInTheDocument();
      expect(within(screen.getByRole("tab", { name: "T-1 · codex" }))
        .getByLabelText("Agent is actively working")).toBeInTheDocument();
      const workItemLifecycle = screen.getByTestId("agent-state-badge");
      expect(workItemLifecycle).toHaveAttribute("data-state", "active");
      expect(within(workItemLifecycle).getByLabelText("Agent is actively working"))
        .toBeInTheDocument();
    });
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe(
      "ready",
    );
  });

});
