import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import type { WorkItemRow } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useStudioStore } from "../features/projects/store";
import { useAgentStatusStore } from "../features/agents/status";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { seedConfig } from "../features/studio/stores/configStore";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { setStatesSorted } from "../shared/query/stateCatalog";
import { useClientStore } from "../state/clientStore";
import { workItem } from "./seam";

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
    documentRegistry.listTaskDocuments.mockResolvedValue([]);
    documentRegistry.listScratchDocuments.mockResolvedValue([]);
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

});
