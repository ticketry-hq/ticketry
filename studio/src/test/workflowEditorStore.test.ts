import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { queryClient } from "../shared/query/queryClient";

const workflowApi = vi.hoisted(() => ({
  getIssueTypes: vi.fn(),
  getStates: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  setIssueTypeWorkflowStartState: vi.fn(),
}));

vi.mock("../shared/api/client", async (load) => ({
  ...(await load<typeof import("../shared/api/client")>()),
  ...workflowApi,
}));

const workflow = {
  issue_type_id: "story",
  start_state_id: "todo",
  workflow_revision: 3,
  transitions: [
    { from_state_id: "todo", to_state_id: "build", agent_allowed: true },
    { from_state_id: "build", to_state_id: "done", agent_allowed: true },
  ],
  launch_bindings: [{
    state_id: "build",
    prompt: "Implement it.",
    required_skills: [],
    agent: "codex",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    auto_start: true,
    subtree_run_enabled: false,
  }],
  warnings: [],
};

describe("workflow editor canonical resources", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient.clear();
    workflowApi.getIssueTypes.mockResolvedValue([
      { id: "story", name: "Story", level: "task", sort_order: 0 },
    ]);
    workflowApi.getStates.mockResolvedValue([
      { id: "todo", name: "Todo", group: "unstarted", sort_order: 0 },
      { id: "build", name: "Build", group: "started", sort_order: 1 },
      { id: "done", name: "Done", group: "completed", sort_order: 2 },
    ]);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    workflowApi.getProviderCatalog.mockResolvedValue({
      value: { activated_providers: [], global_default: null },
    });
    workflowApi.getIssueTypeWorkflowSettings.mockResolvedValue(workflow);
    workflowApi.setIssueTypeWorkflowStartState.mockResolvedValue({});
    useWorkflowEditorStore.setState({
      projectId: null,
      selectedTypeId: null,
      issueTypes: [],
      states: [],
      stateWorkItemCounts: {},
      providerCapabilities: [],
      workflows: {},
      stagedStateIds: {},
      loading: false,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
  });

  it("loads the selected workflow with the project needed by canonical binding reads", async () => {
    await useWorkflowEditorStore.getState().load("project-1");

    expect(workflowApi.getIssueTypeWorkflowSettings)
      .toHaveBeenCalledWith("project-1", "story");
    expect(useWorkflowEditorStore.getState().workflows.story).toEqual(workflow);
  });

  it("counts canonical work-item state UUIDs for state-delete blockers", async () => {
    workflowApi.getProjectWorkItems.mockResolvedValue([
      { id: "item-1", state: "build" },
      { id: "item-2", state: "build" },
    ]);

    await useWorkflowEditorStore.getState().load("project-1");

    expect(useWorkflowEditorStore.getState().stateWorkItemCounts).toEqual({
      build: 2,
    });
  });

  it("reloads the canonical aggregate after a row mutation", async () => {
    const changed = {
      ...workflow,
      start_state_id: "build",
      workflow_revision: 4,
      transitions: [workflow.transitions[1]],
      launch_bindings: workflow.launch_bindings,
    };
    workflowApi.getIssueTypeWorkflowSettings
      .mockResolvedValueOnce(workflow)
      .mockResolvedValueOnce(changed);
    await useWorkflowEditorStore.getState().load("project-1");

    await useWorkflowEditorStore.getState().setStartState(
      "story",
      "build",
      "start:story",
    );

    expect(workflowApi.setIssueTypeWorkflowStartState)
      .toHaveBeenCalledWith("story", "build", 3);
    expect(workflowApi.getIssueTypeWorkflowSettings)
      .toHaveBeenLastCalledWith("project-1", "story");
    expect(useWorkflowEditorStore.getState().workflows.story).toEqual(changed);
  });

  it("derives prune impact locally from the loaded transition graph", async () => {
    await useWorkflowEditorStore.getState().load("project-1");

    const impact = await useWorkflowEditorStore.getState().previewImpact(
      "story",
      {
        operation: "remove_transition",
        from_state_id: "todo",
        to_state_id: "build",
      },
      "remove:todo:build",
    );

    expect(impact).toEqual({
      workflow_revision: 3,
      deleted_transitions: workflow.transitions,
      deleted_launch_bindings: workflow.launch_bindings,
      disabled_auto_start_state_ids: ["build"],
    });
    expect(workflowApi.getIssueTypeWorkflowSettings).toHaveBeenCalledOnce();
  });
});
