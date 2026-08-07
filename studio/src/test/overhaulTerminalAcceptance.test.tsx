import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
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

function run(agentRunId: string, taskId: string, state = "working" as const) {
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
  });

  it("[overhaul-08] cycles live terminals by keyboard into a collapsed branch", () => {
    const parent = workItem({
      id: "story-1",
      name: "Parent",
      state: TODO,
      rank: "Z",
      sub_issues_count: 1,
    });
    const child = workItem({
      id: "child-1",
      name: "Child",
      key: "MEML-2",
      state: TODO,
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
      tmux_session_name: "ticketry-run-1",
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
});
