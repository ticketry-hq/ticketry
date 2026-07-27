import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSummary } from "../features/studio/lib/types";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useIssueStore } from "../features/work-items/issue-detail";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import type { State, WorkItem } from "../shared/api/types";

const workflowApi = vi.hoisted(() => ({
  deleteState: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getStates: vi.fn(),
}));

vi.mock("../features/studio/workflowApi", () => workflowApi);

const DOING: State = {
  id: "doing",
  name: "Doing",
  group: "started",
  color: "#f59e0b",
  sort_order: 0,
};
const REVIEW: State = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#7dcfff",
  sort_order: 1,
};
const DONE: State = {
  id: "done",
  name: "Done",
  group: "completed",
  color: "#22c55e",
  sort_order: 2,
};
const SCRATCH = {
  id: null,
  name: "Scratch",
  group: "backlog",
  color: null,
};

function workItem(
  id: string,
  state: State,
  stateRevision = 1,
): WorkItem {
  return {
    id,
    key: `MEML-${id}`,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    issue_type: { id: "story", name: "Story", level: "task" },
    state,
    state_revision: stateRevision,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
  };
}

function taskRow(item: WorkItem): TaskSummary {
  return {
    id: item.id,
    name: item.name,
    project_id: item.project_id,
    sequence_id: item.sequence_id,
    issue_type: item.issue_type,
    state: item.state ?? {
      id: null,
      name: "No state",
      group: "",
      color: null,
    },
    state_revision: item.state_revision,
    assignees: [],
    labels: [],
    description_html: item.description_html,
    description_stripped: item.description_stripped,
    description: item.description,
    parent_id: item.parent_id,
    sub_issues_count: item.sub_issues_count,
  };
}

const workflow = {
  issue_type_id: "story",
  start_state_id: "review",
  workflow_revision: 4,
  transitions: [],
  launch_bindings: [],
  warnings: [],
};

describe("workflow state removal synchronization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    workflowApi.deleteState.mockResolvedValue(undefined);
    workflowApi.getStates.mockResolvedValue([REVIEW, DONE]);
    workflowApi.getIssueTypeWorkflowSettings.mockResolvedValue(workflow);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    useWorkflowEditorStore.setState({
      projectId: "project-1",
      issueTypes: [{
        id: "story",
        name: "Story",
        level: "task",
        color: null,
        icon: null,
        sort_order: 0,
        is_default: true,
      }],
      states: [DOING, REVIEW, DONE],
      workflows: { story: workflow },
      action: null,
      notice: null,
      error: null,
    });
    useTasksStore.setState({
      selectedProjectId: null,
      tasks: [],
      states: [],
      subtasks: {},
      details: null,
      seenStateRevisions: {},
      pendingStateDeltas: {},
    });
    useBacklogStore.setState({
      projectId: null,
      items: [],
      states: [],
      seenStateRevisions: {},
      pendingStateDeltas: {},
    });
    useIssueStore.setState({ open: null, children: [] });
  });

  it("removes an unoccupied deleted state from every active catalog", async () => {
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [SCRATCH, DOING, REVIEW, DONE],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [DOING, REVIEW, DONE],
    });

    await useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      impactToken: "impact",
    });

    expect(useWorkflowEditorStore.getState().states).toEqual([REVIEW, DONE]);
    expect(useTasksStore.getState().states).toEqual([SCRATCH, REVIEW, DONE]);
    expect(useBacklogStore.getState().states).toEqual([REVIEW, DONE]);
  });

  it("reconciles every loaded copy to the replacement without a live feed", async () => {
    const stale = workItem("story-1", DOING, 3);
    const child = workItem("child-1", DOING, 3);
    child.parent_id = stale.id;
    const authoritative = workItem("story-1", REVIEW, 4);
    const authoritativeChild = workItem("child-1", REVIEW, 4);
    authoritativeChild.parent_id = authoritative.id;
    workflowApi.getProjectWorkItems.mockResolvedValue([
      authoritative,
      authoritativeChild,
    ]);

    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedTaskId: stale.id,
      states: [SCRATCH, DOING, REVIEW, DONE],
      tasks: [taskRow(stale)],
      subtasks: { [stale.id]: [taskRow(child)] },
      details: { task: taskRow(stale) },
      pendingStateDeltas: {
        [stale.id]: { state: taskRow(stale).state, revision: 3 },
      },
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [DOING, REVIEW, DONE],
      items: [stale, child],
      pendingStateDeltas: {
        [stale.id]: {
          state: DOING,
          revision: 3,
          updatedAt: stale.updated_at,
        },
      },
    });
    useIssueStore.setState({
      open: { task: stale, attachments: [] },
      children: [child],
    });

    await useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      replacementId: "review",
      replacementName: "Review",
      impactToken: "impact",
    });

    expect(useTasksStore.getState()).toMatchObject({
      states: [SCRATCH, REVIEW, DONE],
      tasks: [{ id: stale.id, state: REVIEW, state_revision: 4 }],
      subtasks: {
        [stale.id]: [{ id: child.id, state: REVIEW, state_revision: 4 }],
      },
      details: {
        task: { id: stale.id, state: REVIEW, state_revision: 4 },
      },
      pendingStateDeltas: {},
    });
    expect(useBacklogStore.getState()).toMatchObject({
      states: [REVIEW, DONE],
      items: [
        { id: stale.id, state: REVIEW, state_revision: 4 },
        { id: child.id, state: REVIEW, state_revision: 4 },
      ],
      pendingStateDeltas: {},
    });
    expect(useIssueStore.getState()).toMatchObject({
      open: {
        task: { id: stale.id, state: REVIEW, state_revision: 4 },
      },
      children: [
        { id: child.id, state: REVIEW, state_revision: 4 },
      ],
    });
  });

  it("preserves a newer replacement frame while reconciling the open issue", async () => {
    const staleOpen = workItem("story-1", DOING, 3);
    const feedItem = workItem("story-1", REVIEW, 5);
    const fetchedItem = workItem("story-1", REVIEW, 4);
    workflowApi.getProjectWorkItems.mockResolvedValue([fetchedItem]);
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [SCRATCH, DOING, REVIEW, DONE],
      tasks: [taskRow(feedItem)],
      pendingStateDeltas: {
        [feedItem.id]: { state: taskRow(feedItem).state, revision: 5 },
      },
    });
    useBacklogStore.setState({
      projectId: "project-1",
      states: [DOING, REVIEW, DONE],
      items: [feedItem],
      seenStateRevisions: { [feedItem.id]: 5 },
      pendingStateDeltas: {
        [feedItem.id]: {
          state: REVIEW,
          revision: 5,
          updatedAt: feedItem.updated_at,
        },
      },
    });
    useIssueStore.setState({
      open: { task: staleOpen, attachments: [] },
      children: [],
    });

    await useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      replacementId: "review",
      replacementName: "Review",
      impactToken: "impact",
    });

    expect(useTasksStore.getState().tasks[0]).toMatchObject({
      state: REVIEW,
      state_revision: 5,
    });
    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: REVIEW,
      state_revision: 5,
    });
    expect(useIssueStore.getState().open?.task).toMatchObject({
      state: REVIEW,
      state_revision: 4,
    });
  });

  it("moves cached copies immediately when the editor catalog lacks the replacement", async () => {
    const stale = workItem("story-1", DOING, 3);
    const authoritative = workItem("story-1", REVIEW, 4);
    let resolveItems!: (items: WorkItem[]) => void;
    workflowApi.getProjectWorkItems.mockReturnValue(
      new Promise<WorkItem[]>((resolve) => {
        resolveItems = resolve;
      }),
    );
    useWorkflowEditorStore.setState({ states: [DOING, DONE] });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      states: [SCRATCH, DOING, DONE],
      tasks: [taskRow(stale)],
    });

    const removal = useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      replacementId: "review",
      replacementName: "Review",
      replacement: REVIEW,
      impactToken: "impact",
    });

    await vi.waitFor(() => {
      expect(useTasksStore.getState().tasks[0].state).toEqual(REVIEW);
    });
    resolveItems([authoritative]);
    await removal;
  });

  it("reconciles a stale copy loaded while the authoritative refresh is in flight", async () => {
    const lateStale = workItem("late-story", DOING, 3);
    const authoritative = workItem("late-story", REVIEW, 4);
    let resolveItems!: (items: WorkItem[]) => void;
    workflowApi.getProjectWorkItems.mockReturnValue(
      new Promise<WorkItem[]>((resolve) => {
        resolveItems = resolve;
      }),
    );

    const removal = useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      replacementId: "review",
      replacementName: "Review",
      replacement: REVIEW,
      impactToken: "impact",
    });
    await vi.waitFor(() => {
      expect(workflowApi.getProjectWorkItems).toHaveBeenCalled();
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      tasks: [taskRow(lateStale)],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      items: [lateStale],
    });
    useIssueStore.setState({
      open: { task: lateStale, attachments: [] },
    });
    resolveItems([authoritative]);
    await removal;

    expect(useTasksStore.getState().tasks[0]).toMatchObject({
      state: REVIEW,
      state_revision: 4,
    });
    expect(useBacklogStore.getState().items[0]).toMatchObject({
      state: REVIEW,
      state_revision: 4,
    });
    expect(useIssueStore.getState().open?.task).toMatchObject({
      state: REVIEW,
      state_revision: 4,
    });
  });

  it("evicts an affected cached copy absent from the authoritative project rows", async () => {
    const stale = workItem("missing-story", DOING, 3);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedTaskId: stale.id,
      tasks: [taskRow(stale)],
    });
    useBacklogStore.setState({
      projectId: "project-1",
      items: [stale],
    });
    useIssueStore.setState({
      open: { task: stale, attachments: [] },
      children: [stale],
    });

    await useWorkflowEditorStore.getState().removeState({
      stateId: "doing",
      stateName: "Doing",
      replacementId: "review",
      replacementName: "Review",
      replacement: REVIEW,
      impactToken: "impact",
    });

    expect(useTasksStore.getState().tasks).toEqual([]);
    expect(useBacklogStore.getState().items).toEqual([]);
    expect(useIssueStore.getState().open).toBeNull();
    expect(useIssueStore.getState().children).toEqual([]);
  });
});
