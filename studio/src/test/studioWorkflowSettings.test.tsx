import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { useConfigStore } from "../features/agents/stores/configStore";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { ApiError } from "../shared/api/client";
import type { ScopedWorkflowSettings } from "../shared/api/types";

const workflowApi = vi.hoisted(() => ({
  getStates: vi.fn(),
  getIssueTypes: vi.fn(),
  reorderWorkflowStates: vi.fn(),
  createState: vi.fn(),
  updateState: vi.fn(),
  getStateImpact: vi.fn(),
  deleteState: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  previewIssueTypeWorkflowImpact: vi.fn(),
  addIssueTypeWorkflowTransition: vi.fn(),
  removeIssueTypeWorkflowTransition: vi.fn(),
  removeIssueTypeWorkflowState: vi.fn(),
  setIssueTypeWorkflowTransitionPermission: vi.fn(),
  setIssueTypeWorkflowStartState: vi.fn(),
  upsertIssueTypeWorkflowLaunchBinding: vi.fn(),
  setIssueTypeWorkflowAutoStart: vi.fn(),
  setIssueTypeWorkflowSubtreeRun: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  ...workflowApi,
}));

const states = [
  { id: "todo", name: "Todo", group: "unstarted", color: "#64748b", sort_order: 0 },
  { id: "review", name: "Review", group: "started", color: "#f59e0b", sort_order: 1 },
  { id: "done", name: "Done", group: "completed", color: "#22c55e", sort_order: 2 },
  { id: "idea", name: "Idea", group: "backlog", color: "#8b5cf6", sort_order: 3 },
];

const baseWorkflow: ScopedWorkflowSettings = {
  issue_type_id: "story",
  start_state_id: "todo",
  workflow_revision: 7,
  transitions: [
    { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
    { from_state_id: "review", to_state_id: "done", agent_allowed: true },
  ],
  launch_bindings: [{
    state_id: "done",
    prompt: "Verify the completed work.",
    agent: "claude",
    model: "sonnet",
    reasoning: "high",
    auto_start: false,
    subtree_run_enabled: false,
  }],
  warnings: [],
};

function nextWorkflow(patch: Partial<ScopedWorkflowSettings>): ScopedWorkflowSettings {
  return {
    ...structuredClone(baseWorkflow),
    workflow_revision: baseWorkflow.workflow_revision + 1,
    ...patch,
  };
}

async function openIssueTypes() {
  fireEvent.click(await screen.findByRole("tab", { name: "Issue Types" }));
  await screen.findByRole("tab", { name: "Story" });
}

describe("Studio workflow settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({ modalStack: [{ type: "settings" }], activeBindings: null });
    useTasksStore.setState({ selectedProjectId: "project-1" });
    useConfigStore.setState({
      recentProfileIndex: 0,
      profiles: [{
        name: "Local",
        workspace_slug: "local",
        agent_prompt: null,
        agent_prompts: {},
        module_folders: {},
      }],
    });
    workflowApi.getIssueTypes.mockResolvedValue([
      { id: "module", name: "Module", level: "module", sort_order: 0 },
      { id: "story", name: "Story", level: "task", sort_order: 0 },
      { id: "implementation", name: "Implementation", level: "task", sort_order: 1 },
    ]);
    workflowApi.getStates.mockResolvedValue(states);
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([{
      agent: "claude",
      accepts_model: true,
      accepts_any_model: false,
      model_aliases: ["sonnet", "opus"],
      model_prefixes: ["claude-"],
      reasoning_levels: ["low", "medium", "high"],
    }]);
    workflowApi.getIssueTypeWorkflowSettings.mockImplementation(async (typeId) => ({
      ...structuredClone(baseWorkflow),
      issue_type_id: typeId,
    }));
    workflowApi.setIssueTypeWorkflowStartState.mockResolvedValue(
      nextWorkflow({ start_state_id: "review" }),
    );
    workflowApi.previewIssueTypeWorkflowImpact.mockResolvedValue({
      workflow_revision: 7,
      deleted_transitions: [],
      deleted_launch_bindings: [],
      disabled_auto_start_state_ids: [],
    });
    workflowApi.addIssueTypeWorkflowTransition.mockResolvedValue(nextWorkflow({
      transitions: [
        ...baseWorkflow.transitions,
        { from_state_id: "todo", to_state_id: "done", agent_allowed: true },
      ],
    }));
    workflowApi.removeIssueTypeWorkflowTransition.mockResolvedValue(
      nextWorkflow({ transitions: [] }),
    );
    workflowApi.removeIssueTypeWorkflowState.mockResolvedValue(
      nextWorkflow({ transitions: [], launch_bindings: [] }),
    );
    workflowApi.setIssueTypeWorkflowTransitionPermission.mockResolvedValue(nextWorkflow({
      transitions: [
        { from_state_id: "todo", to_state_id: "review", agent_allowed: false },
      ],
    }));
    workflowApi.upsertIssueTypeWorkflowLaunchBinding.mockResolvedValue(nextWorkflow({
      launch_bindings: [{
        ...baseWorkflow.launch_bindings[0],
        state_id: "review",
        prompt: "Review the implementation.",
      }],
    }));
    workflowApi.setIssueTypeWorkflowAutoStart.mockResolvedValue(nextWorkflow({
      launch_bindings: [{ ...baseWorkflow.launch_bindings[0], auto_start: true }],
    }));
    workflowApi.setIssueTypeWorkflowSubtreeRun.mockResolvedValue(nextWorkflow({
      launch_bindings: [{
        ...baseWorkflow.launch_bindings[0],
        state_id: "review",
        subtree_run_enabled: true,
      }],
    }));
  });

  it("keeps States as a pure catalog and removes draft lifecycle affordances", async () => {
    render(<SettingsModal />);

    const catalog = await screen.findByRole("region", { name: "State catalog" });
    expect(within(catalog).getByDisplayValue("Todo")).toBeInTheDocument();
    expect(within(catalog).getByDisplayValue("Idea")).toBeInTheDocument();
    expect(within(catalog).getByText("Unstarted")).toBeInTheDocument();
    expect(within(catalog).queryByText(/transition/i)).not.toBeInTheDocument();
    expect(within(catalog).queryByText(/launch/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discard/i })).not.toBeInTheDocument();
  });

  it("does not show module issue types in workflow settings", async () => {
    render(<SettingsModal />);
    await openIssueTypes();

    expect(screen.queryByRole("tab", { name: "Module" })).not.toBeInTheDocument();
    expect(workflowApi.getIssueTypeWorkflowSettings).not.toHaveBeenCalledWith("module");
  });

  it("adds and removes transitions from a dropdown and defaults agents to allowed", async () => {
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Todo" }));

    expect(screen.getByText("Can move to: Review")).toBeInTheDocument();
    const destination = screen.getByRole("combobox", {
      name: "Add destination from Todo",
    });
    expect(within(destination).queryByRole("option", { name: "Idea" }))
      .not.toBeInTheDocument();
    fireEvent.change(destination, {
      target: { value: "done" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transition from Todo" }));

    await waitFor(() => expect(workflowApi.addIssueTypeWorkflowTransition)
      .toHaveBeenCalledWith("story", {
        from_state_id: "todo",
        to_state_id: "done",
        agent_allowed: true,
        workflow_revision: 7,
      }));

    workflowApi.previewIssueTypeWorkflowImpact.mockResolvedValueOnce({
      workflow_revision: 8,
      deleted_transitions: [
        { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
      ],
      deleted_launch_bindings: [],
      disabled_auto_start_state_ids: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove transition Todo to Review" }));
    expect(await screen.findByRole("dialog", {
      name: "Workflow deletion impact",
    })).toHaveTextContent("Transition: Todo → Review");
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(workflowApi.removeIssueTypeWorkflowTransition)
      .toHaveBeenCalledWith("story", "todo", "review", 8));
  });

  it("previews every cascading deletion before removing a workflow state", async () => {
    workflowApi.previewIssueTypeWorkflowImpact.mockResolvedValueOnce({
      workflow_revision: 7,
      deleted_transitions: [
        { from_state_id: "review", to_state_id: "done", agent_allowed: true },
      ],
      deleted_launch_bindings: [{
        ...baseWorkflow.launch_bindings[0],
        subtree_run_enabled: true,
      }],
      disabled_auto_start_state_ids: ["done"],
    });
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Review" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Remove Review from workflow",
    }));

    const dialog = await screen.findByRole("dialog", {
      name: "Workflow deletion impact",
    });
    expect(dialog).toHaveTextContent("Transition: Review → Done");
    expect(dialog).toHaveTextContent(
      "transitions, launch prompts, and subtree-run capability",
    );
    expect(dialog).toHaveTextContent("Launch binding: Done");
    expect(dialog).toHaveTextContent("Auto-start: Done");
    expect(dialog).toHaveTextContent("Subtree-run capability: Done");
    expect(workflowApi.removeIssueTypeWorkflowState).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", {
      name: "Confirm state removal",
    }));
    await waitFor(() => expect(workflowApi.removeIssueTypeWorkflowState)
      .toHaveBeenCalledWith("story", "review", 7));
  });

  it("confirms pruning before changing start state and applies permissions", async () => {
    workflowApi.previewIssueTypeWorkflowImpact.mockResolvedValueOnce({
      workflow_revision: 7,
      deleted_transitions: [
        { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
      ],
      deleted_launch_bindings: [],
      disabled_auto_start_state_ids: [],
    });
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.change(screen.getByRole("combobox", { name: "Start State" }), {
      target: { value: "review" },
    });
    expect(await screen.findByRole("dialog", {
      name: "Workflow deletion impact",
    })).toHaveTextContent("Transition: Todo → Review");
    expect(workflowApi.setIssueTypeWorkflowStartState).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm start state" }));
    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowStartState)
      .toHaveBeenCalledWith("story", "review", 7));

    fireEvent.click(screen.getByRole("button", { name: "Expand Review" }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Agents may move Review to Done",
    }));
    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowTransitionPermission)
      .toHaveBeenCalledWith("story", "review", "done", false, 8));
  });

  it("gates auto-start on valid launch configuration and applies launch edits", async () => {
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Review" }));

    expect(screen.getByRole("checkbox", { name: "Auto-start Review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit launch for Review" }));
    const form = screen.getByRole("form", { name: "Story · Review launch configuration" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Review the implementation." },
    });
    fireEvent.change(within(form).getByRole("combobox", { name: "Agent/provider" }), {
      target: { value: "claude" },
    });

    await waitFor(() => expect(workflowApi.upsertIssueTypeWorkflowLaunchBinding)
      .toHaveBeenLastCalledWith("story", "review", expect.objectContaining({
        prompt: "Review the implementation.",
        agent: "claude",
      }), 7));
    await waitFor(() => expect(screen.getByRole("checkbox", {
      name: "Auto-start Review",
    })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-start Review" }));
    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowAutoStart)
      .toHaveBeenCalledWith("story", "review", true, 8));
  });

  it("sets Run subtree without requiring launch configuration", async () => {
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Review" }));

    const checkbox = screen.getByRole("checkbox", { name: "Run subtree Review" });
    expect(checkbox).toBeEnabled();
    fireEvent.click(checkbox);

    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowSubtreeRun)
      .toHaveBeenCalledWith("story", "review", true, 7));
    await waitFor(() => expect(screen.getByRole("checkbox", {
      name: "Run subtree Review",
    })).toBeChecked());
  });

  it("shows only states reachable from the configured start state", async () => {
    render(<SettingsModal />);
    await openIssueTypes();

    expect(screen.queryByRole("listitem", { name: "Idea workflow state" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Story workflow warnings" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Review workflow state" }))
      .not.toHaveTextContent("warnings");
  });

  it("stages a catalog state until an incoming transition connects it", async () => {
    workflowApi.addIssueTypeWorkflowTransition.mockResolvedValue(nextWorkflow({
      transitions: [
        ...baseWorkflow.transitions,
        { from_state_id: "todo", to_state_id: "idea", agent_allowed: true },
      ],
    }));
    render(<SettingsModal />);
    await openIssueTypes();

    const picker = screen.getByRole("combobox", { name: "Add state to workflow" });
    expect(within(picker).getByRole("option", { name: "Idea" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Review" }))
      .not.toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "idea" } });

    const pending = screen.getByRole("listitem", { name: "Idea pending workflow state" });
    expect(within(pending).getByText("Pending")).toBeInTheDocument();
    expect(within(pending).getByText(/connect it/i)).toBeInTheDocument();
    expect(workflowApi.addIssueTypeWorkflowTransition).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand Todo" }));
    expect(within(screen.getByRole("combobox", {
      name: "Add destination from Todo",
    })).getByRole("option", { name: "Idea" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Connect Idea from" }), {
      target: { value: "todo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Idea" }));

    await waitFor(() => expect(workflowApi.addIssueTypeWorkflowTransition)
      .toHaveBeenCalledWith("story", {
        from_state_id: "todo",
        to_state_id: "idea",
        agent_allowed: true,
        workflow_revision: 7,
      }));
    await waitFor(() => expect(screen.queryByRole("listitem", {
      name: "Idea pending workflow state",
    })).not.toBeInTheDocument());
    expect(screen.getByRole("listitem", { name: "Idea workflow state" }))
      .toBeInTheDocument();
  });

  it("abandons a staged state without a backend write", async () => {
    render(<SettingsModal />);
    await openIssueTypes();

    const picker = screen.getByRole("combobox", { name: "Add state to workflow" });
    fireEvent.change(picker, { target: { value: "idea" } });
    expect(screen.getByRole("listitem", { name: "Idea pending workflow state" }))
      .toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "" } });

    expect(screen.queryByRole("listitem", { name: "Idea pending workflow state" }))
      .not.toBeInTheDocument();
    expect(workflowApi.addIssueTypeWorkflowTransition).not.toHaveBeenCalled();
  });

  it("shows a rejected edit inline on the touched control", async () => {
    workflowApi.setIssueTypeWorkflowTransitionPermission.mockRejectedValueOnce(
      new ApiError(422, "Human-only transition is required.", {
        detail: "Human-only transition is required.",
      }),
    );
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Todo" }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Agents may move Todo to Review",
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Human-only transition is required.",
    );
  });

  it("silently refetches a stale revision and keeps in-progress launch input", async () => {
    workflowApi.upsertIssueTypeWorkflowLaunchBinding.mockRejectedValueOnce(
      new ApiError(409, "Stale workflow revision.", {
        detail: "Stale workflow revision.",
      }),
    );
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit launch for Review" }));
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(prompt, { target: { value: "Keep this draft text." } });
    fireEvent.blur(prompt);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Workflow changed elsewhere. Latest settings loaded.",
    );
    expect(workflowApi.getIssueTypeWorkflowSettings).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveValue("Keep this draft text.");
  });
});
