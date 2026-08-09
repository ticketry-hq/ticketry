import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import { terminalLabel } from "../app/shell/ticket-workspace/selected-ticket/internal/terminalLabel";
import type { WorkItemRow } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status";
import { dispatchStatusFrame } from "../features/agents/status/statusFeed";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { deriveTaskSessions } from "../features/agents/terminal/hooks";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { setStatesSorted } from "../shared/query/stateCatalog";
import { useClientStore } from "../state/clientStore";
import { workItem } from "./seam";

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

const TODO = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: null,
  sort_order: 0,
};

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
  state: "working" | "exited" = "working",
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

function KeymapHarness({ rows }: { rows: WorkItemRow[] }) {
  useGlobalKeymap(rows);
  return null;
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

  it("[overhaul-08] cycles live terminals by keyboard into a collapsed branch", () => {
    const parent = workItem({
      id: "story-1",
      name: "Parent",
      state: TODO.id,
      rank: "Z",
      sub_issues_count: 1,
    });
    const child = workItem({
      id: "child-1",
      name: "Child",
      key: "MEML-2",
      state: TODO.id,
      parent_id: "story-1",
      rank: "A",
    });
    queryClient.setQueryData(queryKeys.tasks.byModule("project-1", "module-1"), {
      rootIds: ["story-1"],
      children: { "story-1": ["child-1"], "child-1": [] },
      order: ["story-1", "child-1"],
    });
    queryClient.setQueryData(queryKeys.workItems.byId(parent.id), parent);
    queryClient.setQueryData(queryKeys.workItems.byId(child.id), child);
    setStatesSorted("project-1", [TODO]);

    useTerminalStore.setState({
      sessions: {
        "session-parent": session("session-parent", "story-1", "run-parent"),
        "session-child": session("session-child", "child-1", "run-child"),
      },
      sessionByRun: {
        "run-parent": "session-parent",
        "run-child": "session-child",
      },
    });
    useClientStore.setState({ activeByTask: { "story-1": "session-parent" } });
    useAgentStatusStore.setState({
      runs: {
        "run-parent": run("run-parent", "story-1"),
        "run-child": run("run-child", "child-1"),
      },
    });
    const rows: WorkItemRow[] = [
      {
        kind: "work-item",
        id: "story-1",
        depth: 0,
        parentId: null,
        expandable: true,
        expanded: false,
      },
    ];
    render(<KeymapHarness rows={rows} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "\\",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(useClientStore.getState().selectedTaskId).toBe("child-1");
    expect(useClientStore.getState().activeByTask["child-1"]).toBe("session-child");
    expect(useClientStore.getState().collapsedStateIds.has("todo")).toBe(false);
  });

  it("[overhaul-09] keeps an externally killed terminal tab and presents it as dead", () => {
    const meta = session("session-1", "story-1", "run-1", "session_lost");
    const tabs = deriveTaskSessions(
      "story-1",
      { "session-1": meta },
      { "run-1": run("run-1", "story-1") },
      new Set(),
    );

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: "session-1", lifecycle: "lost" });
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

  it("[overhaul-36] clears a false exited badge when reconciliation recovers the live run", () => {
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

    dispatchStatusFrame({
      v: 1,
      type: "snapshot",
      scope: { project_id: "project-1", task_id: null },
      runs: [{
        ...exitedRun,
        state: "working",
        updated_at: "2026-08-07T12:06:00Z",
      }],
      automation_attempts: [],
      at: "2026-08-07T12:06:00Z",
    });

    const tabs = deriveTaskSessions(
      "story-1",
      useTerminalStore.getState().sessions,
      useAgentStatusStore.getState().runs,
      new Set(),
    );
    expect(tabs[0]).toMatchObject({ id: "session-1", lifecycle: "working" });
    expect(useTerminalStore.getState().sessions["session-1"]?.status).toBe(
      "ready",
    );
  });

  it("[overhaul-16] resumes a dormant run into a selected terminal tab", async () => {
    terminalApi.listResumableTerminals.mockResolvedValue([{
      agent_run_id: "run-old",
      agent: "codex",
      status: "exited",
      started_at: "2026-08-07T12:00:00Z",
      ended_at: "2026-08-07T12:30:00Z",
      provider_session_id: "provider-session",
      resumed_from: null,
      scope: "task",
    }]);
    terminalApi.resumeTerminal.mockResolvedValue({
      agent_run_id: "run-new",
      resumed_from: "run-old",
    });
    useAgentStatusStore.setState({
      runs: {
        "run-old": run("run-old", "story-1", "exited"),
      },
    });

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

    const resume = await screen.findByRole("button", {
      name: "Resume codex terminal",
    });
    expect(screen.queryByText("codex ✕")).not.toBeInTheDocument();

    fireEvent.click(resume);

    await waitFor(() => {
      expect(terminalApi.resumeTerminal).toHaveBeenCalledWith("run-old");
      expect(Object.values(useTerminalStore.getState().sessions)).toContainEqual(
        expect.objectContaining({ agentRunId: "run-new" }),
      );
    });
    expect(useClientStore.getState().workspaces["story-1"]?.active).toBe(
      "terminal",
    );
    expect(screen.getByRole("tab", { name: "T-350 · codex" }))
      .toHaveAttribute("aria-selected", "true");
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
});
