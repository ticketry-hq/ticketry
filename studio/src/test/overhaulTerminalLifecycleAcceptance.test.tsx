import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { AgentStateBadge } from "../features/agents/lifecycle";
import { useAgentStatusStore } from "../features/agents/status";
import { applySnapshotFrame } from "../features/agents/status/stream/statusSnapshot";
import { applyRunStatusFrame } from "../features/agents/status/stream/runStatusHolding";
import {
  lifecycleStatusFrame,
  terminalStatusFrame,
} from "../features/agents/status/testing/durableStatusFrames";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { deriveTaskSessions } from "../features/agents/terminal/hooks";
import { reduceLifecycle } from "../features/agents/terminal/lifecycle";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const terminalApi = vi.hoisted(() => ({
  resumeTerminal: vi.fn(),
}));

const documentRegistry = vi.hoisted(() => ({
  listTaskDocuments: vi.fn(),
  listScratchDocuments: vi.fn(),
}));

vi.mock("../features/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/documents")>()),
  ...documentRegistry,
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

// Terminal session reads moved to the Rust Terminal Session graph, so the seam
// a test controls is the read transport, not a host API module.
const terminalReads = vi.hoisted(() => {
  const resumable = vi.fn();
  return {
    readTaskTerminalSessions: vi.fn(),
    readScratchTerminalSessions: vi.fn(),
    readTaskResumableTerminalSessions: resumable,
    readScratchResumableTerminalSessions: resumable,
  };
});

vi.mock(
  "../features/agents/terminal/internal/sessionReadTransport",
  () => terminalReads,
);

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
    installDesktopGraphQlRuntime();
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
    documentRegistry.listTaskDocuments.mockResolvedValue([]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
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

    // A project switch tears the subscription down asynchronously, so a
    // queued snapshot from the previous project can still arrive. The feed
    // refuses it rather than reconciling this project's runs as absent.
    applySnapshotFrame({
      __typename: "RunStatusSnapshot",
      project_id: "previous-project",
      cursor: 12,
      at: "2026-08-07T12:01:00Z",
      runs: [],
      automation_attempts: [],
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
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "codex terminal" }))
      .toContainElement(screen.getByLabelText("Agent session has exited"));
    expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();

    const applyWorkingSnapshot = (updatedAt: string) =>
      applySnapshotFrame({
        __typename: "RunStatusSnapshot",
        project_id: "project-1",
        cursor: 21,
        at: updatedAt,
        runs: [{
          ...exitedRun,
          state: "working",
          updated_at: updatedAt,
          provider_session_id: null,
          launch_state: "Implement",
          launch_model: "gpt-5.6",
          effective_state: "working",
          output_sequence: 1,
          last_output_at: updatedAt,
        }],
        automation_attempts: [],
      });

    act(() => {
      // A replayed active *delta* cannot revive a run after a real terminal
      // event: at equal timestamps the terminal record retains precedence.
      useAgentStatusStore
        .getState()
        .upsertRun({ ...exitedRun, state: "working" });
    });
    expect(screen.getByLabelText("Agent session has exited")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();

    act(() => {
      // A snapshot is authoritative for liveness even without a newer stamp:
      // a quiet run keeps its last hook timestamp, so a repaired snapshot
      // must recover every presentation derived from the shared status-feed
      // holding without recreating the tab.
      applyWorkingSnapshot(exitedRun.updated_at);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent session has exited"))
        .not.toBeInTheDocument();
      expect(within(screen.getByRole("tab", { name: "Implement codex terminal" }))
        .getByLabelText("Terminal output has not changed for 60 seconds (the session is still live)"))
        .toBeInTheDocument();
      const workItemLifecycle = screen.getByTestId("agent-state-badge");
      expect(workItemLifecycle).toHaveAttribute("data-state", "idle");
      expect(within(workItemLifecycle).getByLabelText(
        "Terminal output has not changed for 60 seconds (the session is still live)",
      ))
        .toBeInTheDocument();
    });
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe(
      "ready",
    );
    expect(useAgentStatusStore.getState().runs["run-1"]).toMatchObject({
      launch_state: "Implement",
      launch_model: "gpt-5.6",
    });
  });

  it("[overhaul-137] presents a stopped Codex run as needing input on its tab and work-item status", async () => {
    // Codex's `Stop` hook normalizes to `awaiting_input` (#660): an open Codex
    // terminal has stopped because Codex is waiting for the user. Studio holds
    // no Codex-specific display rule — the shared reducer turns that kind into
    // `needs_input`, and the one projection drives both the terminal tab and
    // the aggregate work-item status.
    const projected = reduceLifecycle("working", "awaiting_input");
    expect(projected).toBe("needs_input");

    const meta = session("session-1", "story-1", "run-1");
    const workingRun = {
      ...run("run-1", "story-1", "working"),
      project_id: "project-1",
      agent: "codex" as const,
    };
    useTerminalStore.setState({
      sessions: { "session-1": meta },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": workingRun } });

    render(
      <QueryClientProvider client={queryClient}>
        <AgentStateBadge issueId="story-1" />
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    expect(
      within(screen.getByRole("tab", { name: "codex terminal" })).getByLabelText(
        "Agent is actively working",
      ),
    ).toBeInTheDocument();

    act(() => {
      applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: projected,
        at: "2026-08-07T12:05:00Z",
      }));
    });

    await waitFor(() => {
      expect(
        within(screen.getByRole("tab", { name: "codex terminal" })).getByLabelText(
          "Agent is waiting for your input",
        ),
      ).toBeInTheDocument();
      const workItemLifecycle = screen.getByTestId("agent-state-badge");
      expect(workItemLifecycle).toHaveAttribute("data-state", "attention");
      expect(
        within(workItemLifecycle).getByLabelText(
          "Agent is waiting for your input",
        ),
      ).toBeInTheDocument();
    });
    // The correction stays a provider-adapter fix: the run is not treated as a
    // completed turn or an exited session.
    expect(screen.queryByLabelText("Agent session has exited")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Agent finished its turn and is awaiting you"),
    ).not.toBeInTheDocument();
  });

  it("[overhaul-138] moves a gracefully exited terminal from live tabs to resumable sessions", async () => {
    const meta = session("session-1", "story-1", "run-1");
    const workingRun = {
      ...run("run-1", "story-1", "working"),
      project_id: "project-1",
      agent: "codex" as const,
    };
    useTerminalStore.setState({
      sessions: { "session-1": meta },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({ runs: { "run-1": workingRun } });

    render(
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("tab", { name: "codex terminal" })).toBeInTheDocument();
    await waitFor(() => expect(terminalReads.readTaskResumableTerminalSessions).toHaveBeenCalled());

    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([
      {
        agent_run_id: "run-1",
        agent: "codex",
        status: "terminated",
        started_at: "2026-08-07T12:00:00Z",
        provider_session_id: "provider-session-1",
        resumed_from: null,
        scope: "task",
      },
    ]);
    act(() => {
      applyRunStatusFrame(terminalStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "exited",
        at: "2026-08-07T12:05:00Z",
      }));
    });

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "codex terminal" }))
        .not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Resume codex terminal" }))
        .toBeInTheDocument();
    });
    expect(useTerminalStore.getState().sessions).toEqual({});
    expect(screen.queryByText("Session lost")).not.toBeInTheDocument();
  });

});
