import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { terminalLabel } from "../app/shell/ticket-workspace/selected-ticket/internal/terminalLabel";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const terminalApi = vi.hoisted(() => ({
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
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
    documentRegistry.listTaskDocuments.mockResolvedValue([]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
  });

  it("[overhaul-35] labels task-bound terminal tabs with the compact ticket identifier", async () => {
    // A live spawn carries its own sequence; a restored attach carries none and
    // must read the workspace's sequence instead. Both land in the same strip.
    useTerminalStore.setState({
      sessions: { "session-live": session("session-live", "story-1", "run-live") },
      sessionByRun: { "run-live": "session-live" },
    });
    useAgentStatusStore.setState({
      runs: {
        "run-live": run("run-live", "story-1"),
        "run-restored": run("run-restored", "story-1"),
      },
    });
    act(() => {
      useTerminalStore.getState().attachPersisted({
        agent_run_id: "run-restored",
        created_at: "2026-08-07T12:00:00Z",
      });
    });
    const restored = Object.values(useTerminalStore.getState().sessions).find(
      (meta) => meta.agentRunId === "run-restored",
    );
    expect(restored?.ticketSeq).toBeNull();

    render(
      <QueryClientProvider client={queryClient}>
        <SelectedTicketContent
          bucket="story-1"
          projectId="project-1"
          moduleId="module-1"
          ticketSeq={350}
          owner="studio"
          details={<div>Issue details</div>}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("tab", { name: "T-350 · codex" })).toHaveLength(2);
    });
    expect(
      screen.getAllByRole("button", { name: "Close terminal T-350 · codex" }),
    ).toHaveLength(2);

    // Identity, persistence, and run ownership stay on the opaque identifiers.
    expect(useTerminalStore.getState().sessionByRun["run-live"]).toBe("session-live");

    const scratchPlan = {
      ...session("session-plan", "story-1", "run-plan"),
      taskId: null,
      ticketSeq: null,
      isPlanning: true,
    };
    // Scratch, taskless, and sequence-less sessions keep identifier-free labels,
    // and no candidate sequence can compose a `T-null`/`T-undefined` label.
    expect(terminalLabel(scratchPlan)).toBe("plan");
    expect(terminalLabel({ ...scratchPlan, isPlanning: false, isInstant: true }))
      .toBe("instant");
    expect(terminalLabel({ ...scratchPlan, isPlanning: false })).toBe("codex");
    expect(terminalLabel({ ...scratchPlan, isPlanning: false }, null)).toBe("codex");
    expect(terminalLabel({ ...scratchPlan, isPlanning: false }, undefined))
      .toBe("codex");
    expect(terminalLabel({ ...scratchPlan, isPlanning: false }, Number.NaN))
      .toBe("codex");
    expect(terminalLabel(session("session-x", "story-1", "run-x"), 350))
      .toBe("T-350 · codex");
  });

  it("[overhaul-49] restores a persisted terminal when its run projection arrives later", async () => {
    terminalApi.getTerminals.mockResolvedValue([{
      agent_run_id: "run-late",
      created_at: "2026-08-07T12:00:00Z",
    }]);

    render(
      <QueryClientProvider client={queryClient}>
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

    await waitFor(() => expect(terminalApi.getTerminals).toHaveBeenCalled());
    expect(useTerminalStore.getState().sessions).toEqual({});

    act(() => {
      useAgentStatusStore.setState({
        runs: { "run-late": run("run-late", "story-1") },
      });
    });

    await waitFor(() => {
      expect(Object.values(useTerminalStore.getState().sessions)).toContainEqual(
        expect.objectContaining({ agentRunId: "run-late" }),
      );
    });
    expect(screen.getByRole("tab", { name: "T-1 · codex" }))
      .toBeInTheDocument();
  });

});
