import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../app/shell/ticket-workspace/selected-ticket";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { synchronizeActiveStateCatalogs } from "../features/workflows/stateCatalogSync";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { useSettingsStore } from "../features/settings/store";
import { getCapabilitiesSnapshot, seedCapabilities } from "../features/settings/queries";
import { ApiError } from "../shared/api/client";
import type { State, WorkItem } from "../shared/api/types";
import type { TaskSummary } from "../features/studio/lib/types";

const workflowApi = vi.hoisted(() => ({
  addIssueTypeWorkflowTransition: vi.fn(),
  createState: vi.fn(),
  updateState: vi.fn(),
  getStates: vi.fn(),
  getIssueTypes: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  setIssueTypeWorkflowStartState: vi.fn(),
  setIssueTypeWorkflowSubtreeRun: vi.fn(),
}));

vi.mock("../features/studio/workflowApi", () => workflowApi);

const workflow = {
  issue_type_id: "story",
  start_state_id: "todo",
  workflow_revision: 3,
  transitions: [],
  launch_bindings: [],
  warnings: [],
};

function taskRow(id: string, state: State): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state: {
      id: state.id,
      name: state.name,
      group: state.group,
      color: state.color,
      sort_order: state.sort_order,
    },
    description: null,
    parent_id: null,
    sub_issues_count: 0,
  };
}

function workItem(id: string, state: State): WorkItem {
  return {
    id,
    key: `MEML-${id}`,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "story", name: "Story", level: "task" },
    state,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
  };
}

describe("workflowEditorStore scoped apply", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    workflowApi.getIssueTypes.mockResolvedValue([
      { id: "story", name: "Story", level: "task", sort_order: 0 },
    ]);
    workflowApi.getStates.mockResolvedValue([
      { id: "todo", name: "Todo", group: "unstarted", sort_order: 0 },
      { id: "idea", name: "Idea", group: "backlog", sort_order: 1 },
    ]);
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    workflowApi.getIssueTypeWorkflowSettings.mockResolvedValue(workflow);
    useTasksStore.setState({
      selectedProjectId: null,
      states: [],
    });
    useBacklogStore.setState({
      projectId: null,
      items: [],
      states: [],
    });
    useIssueStore.setState({
      open: null,
      children: [],
    });
    useUIStore.setState({
      collapsedStateNames: new Set(),
    });
    useSettingsStore.setState({
      projectId: "project-1",
      refreshSubtreeRunCapabilities: vi.fn(),
    });
    seedCapabilities("project-1", {});
  });

  it("loads the selected type's live workflow", async () => {
    await useWorkflowEditorStore.getState().load("project-1");

    expect(useWorkflowEditorStore.getState().workflows.story).toEqual(workflow);
  });

  it("uses the current revision and replaces policy after an apply", async () => {
    workflowApi.setIssueTypeWorkflowStartState.mockResolvedValue({
      ...workflow,
      start_state_id: "done",
      workflow_revision: 4,
    });
    await useWorkflowEditorStore.getState().load("project-1");
    await useWorkflowEditorStore.getState().setStartState(
      "story",
      "done",
      "start:story",
    );

    expect(workflowApi.setIssueTypeWorkflowStartState)
      .toHaveBeenCalledWith("story", "done", 3);
    expect(useWorkflowEditorStore.getState().workflows.story.workflow_revision)
      .toBe(4);
  });

  it("sets subtree-run with the current revision and stores the returned policy", async () => {
    workflowApi.setIssueTypeWorkflowSubtreeRun.mockResolvedValue({
      ...workflow,
      workflow_revision: 4,
      launch_bindings: [{
        state_id: "todo",
        prompt: "",
        agent: null,
        model: null,
        reasoning: null,
        auto_start: false,
        subtree_run_enabled: true,
      }],
    });
    await useWorkflowEditorStore.getState().load("project-1");

    await useWorkflowEditorStore.getState().setSubtreeRun(
      "story",
      "todo",
      true,
      "subtree:story:todo",
    );

    expect(workflowApi.setIssueTypeWorkflowSubtreeRun)
      .toHaveBeenCalledWith("story", "todo", true, 3);
    expect(useWorkflowEditorStore.getState().workflows.story.launch_bindings[0])
      .toMatchObject({ state_id: "todo", subtree_run_enabled: true });
    // Derived from the authoritative response the server just returned, not
    // refetched: the extra GET told us nothing new and every control in the
    // editor blocked its spinner on it.
    expect(useSettingsStore.getState().refreshSubtreeRunCapabilities)
      .not.toHaveBeenCalled();
    expect(getCapabilitiesSnapshot("project-1")).toEqual({ story: ["todo"] });
  });

  it("silently refreshes stale revisions", async () => {
    workflowApi.setIssueTypeWorkflowStartState.mockRejectedValue(
      new ApiError(409, "Stale", { detail: "Stale" }),
    );
    workflowApi.getIssueTypeWorkflowSettings
      .mockResolvedValueOnce(workflow)
      .mockResolvedValueOnce({ ...workflow, workflow_revision: 4 });
    await useWorkflowEditorStore.getState().load("project-1");
    await useWorkflowEditorStore.getState().setStartState(
      "story",
      "done",
      "start:story",
    );

    expect(useWorkflowEditorStore.getState().notice)
      .toBe("Workflow changed elsewhere. Latest settings loaded.");
    expect(useWorkflowEditorStore.getState().workflows.story.workflow_revision)
      .toBe(4);
  });

  it("stages a catalog state locally and abandons it on deselect or reload", async () => {
    await useWorkflowEditorStore.getState().load("project-1");

    useWorkflowEditorStore.getState().stageState("story", "idea");
    expect(useWorkflowEditorStore.getState().stagedStateIds.story).toBe("idea");
    expect(workflowApi.addIssueTypeWorkflowTransition).not.toHaveBeenCalled();

    useWorkflowEditorStore.getState().stageState("story", null);
    expect(useWorkflowEditorStore.getState().stagedStateIds.story).toBeUndefined();

    useWorkflowEditorStore.getState().stageState("story", "idea");
    await useWorkflowEditorStore.getState().load("project-1");
    expect(useWorkflowEditorStore.getState().stagedStateIds).toEqual({});
  });

  it("converts a staged state to a member when an incoming edge succeeds", async () => {
    workflowApi.addIssueTypeWorkflowTransition.mockResolvedValue({
      ...workflow,
      workflow_revision: 4,
      transitions: [{
        from_state_id: "todo",
        to_state_id: "idea",
        agent_allowed: true,
      }],
    });
    await useWorkflowEditorStore.getState().load("project-1");
    useWorkflowEditorStore.getState().stageState("story", "idea");

    await useWorkflowEditorStore.getState().addTransition(
      "story",
      "todo",
      "idea",
      "add:story:todo",
    );

    expect(useWorkflowEditorStore.getState().stagedStateIds.story).toBeUndefined();
    expect(useWorkflowEditorStore.getState().workflows.story.transitions).toEqual([
      {
        from_state_id: "todo",
        to_state_id: "idea",
        agent_allowed: true,
      },
    ]);
  });

  it("re-adds an abandoned state without resurrecting scoped configuration", async () => {
    await useWorkflowEditorStore.getState().load("project-1");
    useWorkflowEditorStore.getState().stageState("story", "idea");
    useWorkflowEditorStore.getState().stageState("story", null);
    useWorkflowEditorStore.getState().stageState("story", "idea");

    expect(useWorkflowEditorStore.getState().workflows.story).toMatchObject({
      transitions: [],
      launch_bindings: [],
    });
  });

  it("synchronizes a created state into every active catalog for the project", async () => {
    const scratch = {
      id: null,
      name: "Scratch",
      group: "backlog",
      color: null,
    };
    const todo = {
      id: "todo",
      name: "Todo",
      group: "unstarted",
      color: "#111111",
      sort_order: 0,
    };
    const staleReview = {
      id: "review",
      name: "Old review",
      group: "unstarted",
      color: "#222222",
      sort_order: 8,
    };
    const done = {
      id: "done",
      name: "Done",
      group: "completed",
      color: "#333333",
      sort_order: 4,
    };
    const created = {
      id: "review",
      name: "Review",
      group: "started",
      color: "#7dcfff",
      sort_order: 2,
    };
    workflowApi.getStates.mockResolvedValue([todo, staleReview, done]);
    workflowApi.createState.mockResolvedValue(created);
    await useWorkflowEditorStore.getState().load("project-1");
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [scratch, todo, staleReview, done],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [todo, staleReview, done],
    });

    await useWorkflowEditorStore.getState().createState("Review", "started");

    expect(useWorkflowEditorStore.getState().states).toEqual([
      todo,
      created,
      done,
    ]);
    expect(useTasksStore.getState().states).toEqual([
      scratch,
      todo,
      created,
      done,
    ]);
    expect(useBacklogStore.getState().states).toEqual([
      todo,
      created,
      done,
    ]);
  });

  it("does not synchronize a created state into catalogs for other projects", async () => {
    const otherState = {
      id: "other",
      name: "Other",
      group: "backlog",
      color: null,
      sort_order: 0,
    };
    workflowApi.createState.mockResolvedValue({
      id: "review",
      name: "Review",
      group: "started",
      color: "#7dcfff",
      sort_order: 2,
    });
    await useWorkflowEditorStore.getState().load("project-1");
    useTasksStore.setState({
      selectedProjectId: "project-2",
      states: [otherState],
    });
    useBacklogStore.setState({
      projectId: "project-2",
      states: [otherState],
    });

    await useWorkflowEditorStore.getState().createState("Review", "started");

    // project-2's catalog is untouched; the Scratch section is local to the
    // Stories pane and always present there.
    expect(
      useTasksStore.getState().states.filter((state) => state.id !== null),
    ).toEqual([otherState]);
    expect(useBacklogStore.getState().states).toEqual([otherState]);
  });

  it("synchronizes a renamed state across open surfaces without losing identity or collapse", async () => {
    const todo: State = {
      id: "todo",
      name: "Todo",
      group: "unstarted",
      color: "#111111",
      sort_order: 0,
    };
    const review: State = {
      id: "review",
      name: "Old review",
      group: "started",
      color: "#222222",
      sort_order: 2,
    };
    const renamed: State = {
      ...review,
      name: "Quality review",
    };
    const story = taskRow("story-1", review);
    const child = taskRow("child-1", review);
    child.parent_id = story.id;
    const backlogStory = workItem("story-1", review);
    const openStory = workItem("story-1", review);
    const openChild = workItem("child-1", review);
    openChild.parent_id = openStory.id;

    workflowApi.getStates.mockResolvedValue([todo, review]);
    workflowApi.updateState.mockResolvedValue(renamed);
    await useWorkflowEditorStore.getState().load("project-1");
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedTaskId: story.id,
      states: [todo, review],
      tasks: [story],
      subtasks: { [story.id]: [child] },
      details: { task: story },
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [todo, review],
      items: [backlogStory],
    });
    useIssueStore.setState({
      open: { task: openStory, attachments: [] },
      children: [openChild],
    });
    useUIStore.setState({
      collapsedStateNames: new Set(["Old review", "Todo"]),
    });

    await useWorkflowEditorStore.getState().updateState("review", {
      name: "Quality review",
    });

    expect(workflowApi.updateState).toHaveBeenCalledWith("review", {
      name: "Quality review",
    });
    expect(useWorkflowEditorStore.getState().states[1]).toEqual(renamed);
    expect(useTasksStore.getState()).toMatchObject({
      selectedTaskId: story.id,
      states: [todo, renamed],
      tasks: [{ id: story.id, state: renamed }],
      subtasks: { [story.id]: [{ id: child.id, state: renamed }] },
      details: { task: { id: story.id, state: renamed } },
    });
    expect(useBacklogStore.getState()).toMatchObject({
      states: [todo, renamed],
      items: [{ id: backlogStory.id, state: renamed }],
    });
    expect(useIssueStore.getState()).toMatchObject({
      open: { task: { id: openStory.id, state: renamed } },
      children: [{ id: openChild.id, state: renamed }],
    });
    expect(useUIStore.getState().collapsedStateNames).toEqual(
      new Set(["Quality review", "Todo"]),
    );
    expect(localStorage.getItem("studio.collapsedStates:v1")).toBe(
      '["Quality review","Todo"]',
    );
  });

  it("migrates a collapsed rename from the active Stories catalog when Settings is cold", () => {
    const review: State = {
      id: "review",
      name: "Old review",
      group: "started",
      color: "#222222",
      sort_order: 2,
    };
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [review],
    });
    useUIStore.setState({
      collapsedStateNames: new Set(["Old review"]),
    });

    synchronizeActiveStateCatalogs(
      "project-1",
      { ...review, name: "Quality review" },
      [],
    );

    expect(useUIStore.getState().collapsedStateNames).toEqual(
      new Set(["Quality review"]),
    );
  });

});
