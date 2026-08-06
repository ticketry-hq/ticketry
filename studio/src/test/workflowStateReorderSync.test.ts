import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import type { State } from "../shared/api/types";
import { getStatesSnapshot, seedStates } from "../shared/query/stateCatalog";

const workflowApi = vi.hoisted(() => ({
  reorderWorkflowStates: vi.fn(),
}));
vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...workflowApi,
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
    seedStates("project-1", [TODO, REVIEW, DONE]);
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "task-1",
      states: [TODO, REVIEW, DONE],
    });
    useClientStore.setState({
      expandedIdsByModule: { "module-1": ["task-1"] },
    });
    useModalStore.setState({
      modalStack: [{ type: "status-update" }],
      activeBindings: null,
    });
  });

  it("publishes authoritative order to the single catalog without disturbing workspace state", async () => {
    const reordered = [
      { ...REVIEW, sort_order: 0 },
      { ...TODO, sort_order: 1 },
      DONE,
    ];
    workflowApi.reorderWorkflowStates.mockResolvedValue(reordered);

    await useWorkflowEditorStore.getState().moveState("review", -1);

    expect(useWorkflowEditorStore.getState().states).toEqual(reordered);
    expect(getStatesSnapshot("project-1")).toEqual(reordered);
    expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
    expect(useClientStore.getState().expandedIdsByModule).toEqual({
      "module-1": ["task-1"],
    });
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "status-update" },
    ]);
  });

});
