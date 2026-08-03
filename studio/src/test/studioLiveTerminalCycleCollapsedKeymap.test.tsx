import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentStatusStore } from "../features/agents/status";
import {
  useTerminalForegroundStore,
  useTerminalStore,
  useWorkspaceTabsStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { selectLiveTerminalStops } from "../features/studio/lib/liveTerminalCycle";
import { selectModuleTaskOrder } from "../features/studio/lib/taskTree";
import type {
  TaskState,
  TaskSummary,
} from "../features/studio/lib/types";
import {
  HEADER,
  type Row,
} from "../features/studio/pages/tasks/TasksPane";
import { useConfigStore } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail";

const todoState: TaskState = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: null,
  sort_order: 0,
};
const doneState: TaskState = {
  id: "done",
  name: "Done",
  group: "completed",
  color: null,
  sort_order: 1,
};

function task(
  id: string,
  parentId: string,
  state: TaskState = todoState,
  childCount = 0,
): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: Number(id.replace(/\D/g, "")) || 1,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state,
    description: null,
    parent_id: parentId,
    sub_issues_count: childCount,
  };
}

function taskRow(summary: TaskSummary, descendantIds: string[] = []): Row {
  return {
    task: summary,
    depth: 0,
    parentId: null,
    hasChildren: summary.sub_issues_count > 0,
    isExpanded: false,
    isLoading: false,
    descendantIds,
  };
}

function session(
  sessionId: string,
  runId: string,
  taskId: string,
): SessionMeta {
  return {
    sessionId,
    agentRunId: runId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    ticketSeq: 1,
    status: "ready",
    transport: "ready",
    backendSession: "alive",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    isDocChat: false,
    docRelPath: null,
    docId: null,
  };
}

function Harness({ rows }: { rows: Row[] }) {
  useGlobalKeymap(rows);
  return null;
}

function pressForwardCycle(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "\\",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function setLiveTerminals(taskIds: string[]): void {
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: Object.fromEntries(
      taskIds.map((taskId) => [
        `run-${taskId}`,
        {
          runId: `run-${taskId}`,
          taskId,
          moduleId: "module-1",
          scope: "task" as const,
          state: "working" as const,
          updatedAt: "2026-07-17T12:00:00Z",
        },
      ]),
    ),
    byTask: Object.fromEntries(
      taskIds.map((taskId) => [taskId, [`run-${taskId}`]]),
    ),
    automationAttempts: {},
    automationByTask: {},
  });
  useTerminalStore.setState({
    sessions: Object.fromEntries(
      taskIds.map((taskId) => [
        `session-${taskId}`,
        session(`session-${taskId}`, `run-${taskId}`, taskId),
      ]),
    ),
    sessionByRun: Object.fromEntries(
      taskIds.map((taskId) => [
        `run-${taskId}`,
        `session-${taskId}`,
      ]),
    ),
    persistedSessions: {},
    resumableSessions: {},
  });
  useWorkspaceTabsStore.setState({
    byTaskId: Object.fromEntries(
      taskIds.map((taskId) => [taskId, [`session-${taskId}`]]),
    ),
    activeByTask: Object.fromEntries(
      taskIds.map((taskId) => [taskId, `session-${taskId}`]),
    ),
    chatByDoc: {},
    focusRequest: null,
  });
}

describe("Studio live-terminal cycle through collapsed rows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    useConfigStore.setState({
      features: { sidebar: true, projects: true },
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [],
      states: [],
      subtasks: {},
    });
    useUIStore.setState({
      sidebarVisible: true,
      focusedPane: "details-or-terminal",
      modalStack: [],
      expandedTaskIds: new Set(),
      expandedModuleId: "module-1",
      collapsedStateNames: new Set(),
      storySearchQuery: "",
    });
    useIssueDrawerWorkspaceStore.setState({ workspaces: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  });

  it("lands on a nested live terminal in natural order and persists every expanded ancestor", async () => {
    const root = task("task-1", "module-1", todoState, 1);
    const parent = task("task-2", root.id, todoState, 1);
    const leaf = task("task-3", parent.id);
    const following = task("task-4", "module-1");
    useTasksStore.setState({
      selectedTaskId: root.id,
      tasks: [following, root],
      states: [todoState],
      subtasks: { [root.id]: [parent], [parent.id]: [leaf] },
    });
    setLiveTerminals([root.id, leaf.id, following.id]);
    render(
      <Harness
        rows={[
          taskRow(root, [parent.id, leaf.id]),
          taskRow(following),
        ]}
      />,
    );

    act(() => {
      pressForwardCycle();
    });

    expect(useTasksStore.getState().selectedTaskId).toBe(leaf.id);
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set([parent.id, root.id]),
    );
    expect(useWorkspaceTabsStore.getState().activeByTask[leaf.id]).toBe(
      `session-${leaf.id}`,
    );
    expect(JSON.parse(localStorage.getItem("studio.expandedSubtasks:v1")!))
      .toEqual({ "module-1": [parent.id, root.id] });
  });

  it("lands inside a collapsed workflow-state section and leaves it expanded", () => {
    const current = task("task-1", "module-1", todoState);
    const hidden = task("task-2", "module-1", doneState);
    useTasksStore.setState({
      selectedTaskId: current.id,
      tasks: [current, hidden],
      states: [todoState, doneState],
    });
    useUIStore.setState({ collapsedStateNames: new Set([doneState.name]) });
    localStorage.setItem(
      "studio.collapsedStates:v1",
      JSON.stringify([doneState.name]),
    );
    setLiveTerminals([current.id, hidden.id]);
    render(
      <Harness
        rows={[
          taskRow(current),
          {
            kind: HEADER,
            key: "header-done",
            stateName: doneState.name,
            stateColor: doneState.color ?? "",
            count: 1,
          },
        ]}
      />,
    );

    act(() => {
      pressForwardCycle();
    });

    expect(useTasksStore.getState().selectedTaskId).toBe(hidden.id);
    expect(useUIStore.getState().collapsedStateNames).toEqual(new Set());
    expect(localStorage.getItem("studio.collapsedStates:v1")).toBe("[]");
  });

  it("derives a hidden stop between its parent and the following visible root", () => {
    const root = task("task-1", "module-1", todoState, 1);
    const hiddenParent = task("task-2", root.id, todoState, 1);
    const hiddenLeaf = task("task-3", hiddenParent.id);
    const following = task("task-4", "module-1");
    const taskOrder = selectModuleTaskOrder(
      [following, root],
      [todoState],
      { [root.id]: [hiddenParent], [hiddenParent.id]: [hiddenLeaf] },
    );
    setLiveTerminals([root.id, hiddenLeaf.id, following.id]);

    const stops = selectLiveTerminalStops({
      moduleId: "module-1",
      taskRows: [
        taskRow(root, [hiddenParent.id, hiddenLeaf.id]),
        taskRow(following),
      ],
      taskOrder,
      agentStatus: useAgentStatusStore.getState(),
      sessions: useTerminalStore.getState().sessions,
      tabsByTask: useWorkspaceTabsStore.getState().byTaskId,
    });

    expect(taskOrder).toEqual([
      root.id,
      hiddenParent.id,
      hiddenLeaf.id,
      following.id,
    ]);
    expect(stops.map((stop) => stop.taskId)).toEqual([
      root.id,
      hiddenLeaf.id,
      following.id,
    ]);
  });
});
