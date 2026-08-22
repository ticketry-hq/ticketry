import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
import { applySnapshotFrame } from "../features/agents/status/stream/statusSnapshot";
import {
  lifecycleStatusFrame,
  statusRunHolding,
  terminalActivityStatusFrame,
  terminalStatusFrame,
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
  terminateTerminal: vi.fn(),
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
const TERMINATED_AT = "2026-08-15T12:00:20.000Z";
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

/** Both surfaces read one projection: neither may say the run is still live. */
function expectExitedEverywhere() {
  expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("exited");
  expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "codex terminal" })).not.toBeInTheDocument();
  // The aggregate rolls up live runs only; an exited run contributes no chip.
  expect(screen.queryByTestId("agent-state-badge")).not.toBeInTheDocument();
}

describe("overhaul acceptance — terminal outcome authority", () => {
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
      workspaces: {
        "story-1": { active: "terminal", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: { "story-1": "session-1" },
      toasts: [],
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
    terminalApi.getDocuments.mockReset().mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockReset().mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockReset().mockResolvedValue([]);
    terminalApi.terminateTerminal.mockReset().mockResolvedValue({
      agent_run_id: "run-1",
      terminated: true,
    });
  });

  afterEach(() => {
    stopStallDeadlines();
    vi.useRealTimers();
  });

  it("[overhaul-140] keeps an explicitly terminated terminal Exited against later time, output, and reconnect", async () => {
    renderWorkspace();
    startStallDeadlines();

    // The tab's X is an explicit termination, not a viewer-only dismissal: it
    // still goes through the backend.
    fireEvent.click(
      screen.getByRole("button", { name: "Close Implement codex terminal" }),
    );
    await vi.waitFor(() => {
      expect(terminalApi.terminateTerminal).toHaveBeenCalledWith("run-1");
    });

    // The backend's confirmed ending arrives on the shared status feed.
    act(() => {
      applyRunStatusFrame(terminalStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "exited",
        at: TERMINATED_AT,
      }));
    });
    expectExitedEverywhere();

    // The obsolete stall deadline went with the outcome: the clock passing the
    // unchanged-output boundary wakes nothing and changes nothing.
    act(() => {
      vi.advanceTimersByTime(STALL_AFTER_MS * 3);
    });
    expect(useAgentStatusStore.getState().stallEpoch).toBe(0);
    expectExitedEverywhere();

    // A capture that raced the kill is delivered afterwards. It may not
    // resurrect the run into a live state, nor re-arm a deadline.
    act(() => {
      const at = new Date().toISOString();
      applyRunStatusFrame(terminalActivityStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        at,
        run: statusRunHolding(run({
          state: "working",
          effective_state: "working",
          output_sequence: 9,
          last_output_at: at,
        })),
      }));
      vi.advanceTimersByTime(STALL_AFTER_MS * 3);
    });
    expectExitedEverywhere();

    // Reloading reads the persisted outcome back: the same Exited status is
    // reconstructed well past the threshold, with no live tab restored.
    act(() => {
      applySnapshotFrame({
        __typename: "RunStatusSnapshot",
        project_id: "project-1",
        cursor: 3,
        runs: [
          statusRunHolding(run({
            state: "exited",
            effective_state: "exited",
            updated_at: TERMINATED_AT,
            last_output_at: LAUNCHED_AT,
          })),
        ],
        automation_attempts: [],
        at: new Date().toISOString(),
      });
    });
    expectExitedEverywhere();
  });

  it("[overhaul-141] restores the latest provider lifecycle state when a live terminal resumes output", async () => {
    renderWorkspace();
    startStallDeadlines();

    act(() => {
      applyRunStatusFrame(lifecycleStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        state: "quiet",
        at: "2026-08-15T12:00:10.000Z",
      }));
      vi.advanceTimersByTime(STALL_AFTER_MS);
    });
    // Both the terminal tab and the aggregate badge read the same projection.
    expect(screen.getAllByLabelText(STALLED_TITLE)).toHaveLength(2);

    // Ordinary resumed output on a still-live run is the opposite case: it
    // clears the overlay and returns the provider's own last word.
    act(() => {
      const at = new Date().toISOString();
      applyRunStatusFrame(terminalActivityStatusFrame({
        projectId: "project-1",
        agentRunId: "run-1",
        at,
        run: statusRunHolding(run({
          state: "working",
          effective_state: "working",
          output_sequence: 2,
          last_output_at: at,
        })),
      }));
    });
    expect(screen.queryByLabelText(STALLED_TITLE)).not.toBeInTheDocument();
    expect(
      screen.getAllByLabelText(
        "No recent activity (heuristic — not a confirmed completion)",
      ).length,
    ).toBeGreaterThan(0);
    expect(useAgentStatusStore.getState().runs["run-1"].state).toBe("quiet");
  });
});
