import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { useStudioStore } from "../features/projects/store";
import { AgentStateBadge } from "../features/agents/lifecycle";
import {
  startStallDeadlines,
  stopStallDeadlines,
  useAgentStatusStore,
  STALL_AFTER_MS,
} from "../features/agents/status";
import { applyRunStatusFrame } from "../features/agents/status/stream/runStatusHolding";
import {
  lifecycleStatusFrame,
  statusRunHolding,
  terminalActivityStatusFrame,
} from "../features/agents/status/testing/durableStatusFrames";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";
import type { RunRecord } from "../features/agents/status";

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
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div data-testid="selected-ticket-terminal">{bucket}</div>
    ),
  }),
);

const LAUNCHED_AT = "2026-08-15T12:00:00.000Z";
const STALLED_TITLE =
  "Terminal output has not changed for 60 seconds (the session is still live)";

function session(): SessionMeta {
  return {
    sessionId: "session-1",
    taskId: "story-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: "run-1",
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: "project-1",
    task_id: "story-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    launch_state: "Implement",
    launch_model: "gpt-5.6",
    started_at: LAUNCHED_AT,
    state: "working",
    effective_state: "working",
    updated_at: LAUNCHED_AT,
    output_sequence: 1,
    last_output_at: LAUNCHED_AT,
    ...overrides,
  };
}

function renderWorkspace() {
  return render(
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
}

function terminalTab() {
  return screen.getByRole("tab", { name: "Implement codex terminal" });
}

describe("overhaul acceptance — terminal output stall", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(LAUNCHED_AT));
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
    useTerminalStore.setState({
      sessions: { "session-1": session() },
      sessionByRun: { "run-1": "session-1" },
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: { "run-1": run() },
      automationAttempts: {},
      automationByTask: {},
      stallEpoch: 0,
    });
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
});
  afterEach(() => {
    stopStallDeadlines();
    vi.useRealTimers();
  });

  it("[overhaul-139] presents a silent live terminal as stalled and recovers on output", () => {
    renderWorkspace();
    startStallDeadlines();

    // The provider's last word is that it is working.
    act(() => {
      applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "working",
        at: "2026-08-15T12:00:10.000Z",
      }));
    });
    expect(
      within(terminalTab()).getByLabelText("Agent is actively working"),
    ).toBeInTheDocument();

    // Output has not changed since launch. One second short of the boundary
    // nothing has changed yet.
    act(() => {
      vi.advanceTimersByTime(STALL_AFTER_MS - 1_000);
    });
    expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();

    // At exactly 60 seconds both surfaces present the same stalled projection,
    // and the accessible text says output stopped changing — not that the
    // session died.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(within(terminalTab()).getByLabelText(STALLED_TITLE)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("agent-state-badge")).getByLabelText(STALLED_TITLE),
    ).toBeInTheDocument();

    // Changed output restores the latest real provider fact, with no remount
    // or reload.
    act(() => {
      const at = new Date().toISOString();
      applyRunStatusFrame(terminalActivityStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        at,
        run: statusRunHolding(run({
          output_sequence: 2,
          last_output_at: at,
        })),
      }));
    });
    expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();
    expect(
      within(terminalTab()).getByLabelText("Agent is actively working"),
    ).toBeInTheDocument();

    // The overlay never wrote a lifecycle fact: the run still holds what the
    // provider last reported.
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("working");
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe("ready");

    // Codex's `Stop` says it is waiting for the person — and a waiting
    // terminal produces no further output, so the inactivity heuristic must
    // not take the signal away from them (#681).
    act(() => {
      applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "needs_input",
        at: "2026-08-15T12:05:00.000Z",
      }));
      vi.advanceTimersByTime(STALL_AFTER_MS * 10);
    });

    expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();
    expect(
      within(terminalTab()).getByLabelText("Agent is waiting for your input"),
    ).toBeInTheDocument();
    const badge = screen.getByTestId("agent-state-badge");
    expect(
      within(badge).getByLabelText("Agent is waiting for your input"),
    ).toBeInTheDocument();
    // The work-item badge still ranks the run as needing the user, which is
    // the whole point of the signal.
    expect(badge.dataset.state).toBe("attention");

    // A pending permission decision is silent for the same reason, and keeps
    // its own presentation just as long.
    act(() => {
      applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "permission_required",
        at: "2026-08-15T12:20:00.000Z",
      }));
      vi.advanceTimersByTime(STALL_AFTER_MS * 10);
    });
    expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();
    expect(
      within(terminalTab()).getByLabelText("A permission decision is pending"),
    ).toBeInTheDocument();
  });
});
