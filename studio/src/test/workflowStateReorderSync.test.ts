import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import type { State } from "../shared/api/types";

const workflowApi = vi.hoisted(() => ({
  reorderWorkflowStates: vi.fn(),
}));
const tasksApi = vi.hoisted(() => ({
  getTasks: vi.fn(),
}));
const backlogApi = vi.hoisted(() => ({
  listProjectWorkItems: vi.fn(),
  listStates: vi.fn(),
}));

vi.mock("../features/studio/workflowApi", () => workflowApi);
vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  getTasks: tasksApi.getTasks,
}));
vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  listProjectWorkItems: backlogApi.listProjectWorkItems,
  listStates: backlogApi.listStates,
}));

const TODO: State = {
  id: "todo",
  name: "Todo",
  group: "unstarted",
  color: "#111111",
  sort_order: 0,
};
const REVIEW: State = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#222222",
  sort_order: 1,
};
const DONE: State = {
  id: "done",
  name: "Done",
  group: "completed",
  color: "#333333",
  sort_order: 2,
};
const SCRATCH = {
  id: null,
  name: "Scratch",
  group: "backlog",
  color: null,
};

describe("workflow-state reorder synchronization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      states: [TODO, REVIEW, DONE],
      action: null,
      notice: null,
      error: null,
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "task-1",
      states: [SCRATCH, TODO, REVIEW, DONE],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [TODO, REVIEW, DONE],
    });
    useUIStore.setState({
      expandedTaskIds: new Set(["task-1"]),
    });
    useModalStore.setState({
      modalStack: [{ type: "status-update" }],
      activeBindings: null,
    });
  });

  it("applies authoritative order to every active catalog without disturbing workspace state", async () => {
    const reordered = [
      { ...REVIEW, sort_order: 0 },
      { ...TODO, sort_order: 1 },
      DONE,
    ];
    workflowApi.reorderWorkflowStates.mockResolvedValue(reordered);

    await useWorkflowEditorStore.getState().moveState("review", -1);

    expect(useWorkflowEditorStore.getState().states).toEqual(reordered);
    expect(useTasksStore.getState().states).toEqual([SCRATCH, ...reordered]);
    expect(useBacklogStore.getState().states).toEqual(reordered);
    expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set(["task-1"]),
    );
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "status-update" },
    ]);
  });

  it("does not let an older Stories catalog load restore stale order", async () => {
    let resolveTasks!: (value: {
      tasks: [];
      states: State[];
      subtasks: {};
    }) => void;
    tasksApi.getTasks.mockReturnValue(
      new Promise((resolve) => {
        resolveTasks = resolve;
      }),
    );
    const loading = useTasksStore
      .getState()
      .loadTasks("project-1", "module-1");
    const reordered = [
      { ...REVIEW, sort_order: 0 },
      { ...TODO, sort_order: 1 },
      DONE,
    ];
    workflowApi.reorderWorkflowStates.mockResolvedValue(reordered);

    await useWorkflowEditorStore.getState().moveState("review", -1);
    resolveTasks({ tasks: [], states: [TODO, REVIEW, DONE], subtasks: {} });
    await loading;

    expect(useTasksStore.getState().states).toEqual([SCRATCH, ...reordered]);
  });

  it("does not let an older IssueDetail catalog load restore stale order", async () => {
    let resolveStates!: (value: State[]) => void;
    backlogApi.listProjectWorkItems.mockResolvedValue([]);
    backlogApi.listStates.mockReturnValue(
      new Promise((resolve) => {
        resolveStates = resolve;
      }),
    );
    const loading = useBacklogStore.getState().loadBacklog("project-1");
    const reordered = [
      { ...REVIEW, sort_order: 0 },
      { ...TODO, sort_order: 1 },
      DONE,
    ];
    workflowApi.reorderWorkflowStates.mockResolvedValue(reordered);

    await useWorkflowEditorStore.getState().moveState("review", -1);
    resolveStates([TODO, REVIEW, DONE]);
    await loading;

    expect(useBacklogStore.getState().states).toEqual(reordered);
  });
});
