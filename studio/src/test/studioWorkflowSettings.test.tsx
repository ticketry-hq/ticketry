import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { seedConfig } from "../features/studio/stores/configStore";
import { SettingsModal } from "../features/studio/modals/SettingsModal";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { ApiError } from "../shared/api/client";
import type { ScopedWorkflowSettings, State, WorkItem } from "../shared/api/types";

const workflowApi = vi.hoisted(() => ({
  getStates: vi.fn(),
  getProjectWorkItems: vi.fn(),
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

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...workflowApi,
}));

const states = [
  { id: "todo", name: "Todo", group: "unstarted", color: "#64748b", sort_order: 0 },
  { id: "review", name: "Review", group: "started", color: "#f59e0b", sort_order: 1 },
  { id: "done", name: "Done", group: "completed", color: "#22c55e", sort_order: 2 },
  { id: "idea", name: "Idea", group: "backlog", color: "#8b5cf6", sort_order: 3 },
];

function workItem(id: string, state: State): WorkItem {
  return {
    id,
    key: `MEML-${id}`,
    name: id,
    project_id: "project-1",
    sequence_id: 1,
    state,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
    issue_type: { id: "story", name: "Story", level: "task" },
  };
}

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
    required_skills: [],
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
  fireEvent.click(await screen.findByRole("tab", { name: "Issue types" }));
  await screen.findByRole("tab", { name: "Story" });
}

describe("Studio workflow settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useModalStore.setState({ modalStack: [{ type: "settings" }], activeBindings: null });
    useTasksStore.setState({ selectedProjectId: "project-1" });
    seedConfig({
      recentProfileIndex: 0,
      profiles: [{
        name: "Local",
        workspace_slug: "local",
        agent_prompt: null,
        agent_prompts: {},
        module_links: [],
      }],
    });
    workflowApi.getIssueTypes.mockResolvedValue([
      { id: "module", name: "Module", level: "module", sort_order: 0 },
      { id: "story", name: "Story", level: "task", sort_order: 0 },
      { id: "implementation", name: "Implementation", level: "task", sort_order: 1 },
    ]);
    workflowApi.getStates.mockResolvedValue(states);
    workflowApi.getProjectWorkItems.mockResolvedValue([
      workItem("todo-1", states[0]),
      workItem("review-1", states[1]),
      workItem("review-2", states[1]),
    ]);
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
    workflowApi.updateState.mockResolvedValue({
      ...states[0],
      name: "Ready",
    });
  });

  it("uses one settings rail and one scroll container", async () => {
    render(<SettingsModal />);

    const dialog = screen.getByRole("dialog", { name: "Studio settings" });
    const rail = within(dialog).getByRole("tablist", {
      name: "Settings sections",
    });
    const statesTab = within(rail).getByRole("tab", { name: "States" });
    const issueTypesTab = within(rail).getByRole("tab", {
      name: "Issue types",
    });
    const modelsTab = within(rail).getByRole("tab", { name: "Models" });
    const workflowGroup = within(rail).getByRole("group", {
      name: "Workflow",
    });
    const configurationGroup = within(rail).getByRole("group", {
      name: "Configuration",
    });
    const workflowHeading = within(workflowGroup).getByRole("heading", {
      name: "Workflow",
      level: 2,
    });
    const configurationHeading = within(configurationGroup).getByRole(
      "heading",
      {
        name: "Configuration",
        level: 2,
      },
    );

    expect(statesTab).toHaveAttribute("aria-selected", "true");
    expect(workflowHeading).not.toHaveAttribute("tabindex");
    expect(configurationHeading).not.toHaveAttribute("tabindex");
    expect(within(workflowGroup).getAllByRole("tab")).toEqual([
      statesTab,
      issueTypesTab,
    ]);
    expect(within(configurationGroup).getAllByRole("tab")).toEqual([
      modelsTab,
    ]);
    expect(within(rail).getAllByRole("tab")).toHaveLength(3);
    expect(within(rail).queryByRole("tab", { name: "Keyboard" }))
      .not.toBeInTheDocument();
    expect(within(dialog).queryByRole("tablist", {
      name: "Workflow settings sections",
    })).not.toBeInTheDocument();

    fireEvent.click(issueTypesTab);
    expect(issueTypesTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Issue Types" }))
      .toBeInTheDocument();

    fireEvent.click(modelsTab);
    expect(modelsTab).toHaveAttribute("aria-selected", "true");

    const scrollContainer = within(dialog).getByTestId(
      "settings-scroll-container",
    );
    expect(
      within(dialog).getAllByTestId("settings-scroll-container"),
    ).toHaveLength(1);
    expect(scrollContainer).toContainElement(
      within(dialog).getByRole("heading", { name: "Models" }),
    );
  });

  it("shows an empty ledger, then records a confirmed instant-apply edit", async () => {
    render(<SettingsModal />);

    const ledger = screen.getByRole("log", { name: "Applied changes" });
    expect(ledger).toHaveTextContent("No changes yet.");

    const name = await screen.findByRole("textbox", {
      name: "State name for Todo",
    });
    fireEvent.change(name, { target: { value: "Ready" } });
    fireEvent.blur(name);

    await waitFor(() => {
      expect(ledger).toHaveTextContent("States");
      expect(ledger).toHaveTextContent("Todo renamed to Ready");
    });
    expect(within(ledger).getByText(/\d{2}:\d{2}/)).toHaveClass("font-mono");
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

  it("shows each state's colour mark and project work-item count", async () => {
    render(<SettingsModal />);

    const todo = await screen.findByRole("listitem", { name: "Todo state" });
    const review = screen.getByRole("listitem", { name: "Review state" });
    const done = screen.getByRole("listitem", { name: "Done state" });

    expect(within(todo).getByRole("textbox", { name: "State name for Todo" }))
      .toHaveValue("Todo");
    expect(within(todo).getByLabelText("State color for Todo"))
      .toHaveValue("#64748b");
    expect(within(todo).getByText("1 work item")).toBeInTheDocument();
    expect(within(review).getByText("2 work items")).toBeInTheDocument();
    expect(within(done).getByText("0 work items")).toBeInTheDocument();
  });

  it("names an occupied state and requires reassignment in its delete confirmation", async () => {
    workflowApi.getStateImpact.mockResolvedValue({
      state_id: "review",
      total_work_items: 2,
      protection_rules: [{
        code: "replacement_required",
        message: "Choose a replacement state.",
      }],
      valid_replacements: [states[2]],
      impact_token: "impact-review",
    });
    render(<SettingsModal />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Review" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Review?" });
    expect(dialog).toHaveTextContent(
      "2 work items are in this state. Move them somewhere before the state is deleted.",
    );
    expect(within(dialog).getByRole("combobox", { name: "Move work items to" }))
      .toHaveValue("done");
    expect(within(dialog).getByRole("button", { name: "Cancel" }))
      .toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete state" }))
      .toBeInTheDocument();
  });

  it("omits reassignment when an empty state can be deleted directly", async () => {
    workflowApi.getStateImpact.mockResolvedValue({
      state_id: "done",
      total_work_items: 0,
      protection_rules: [],
      valid_replacements: states.slice(0, 2),
      impact_token: "impact-done",
    });
    render(<SettingsModal />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Done" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Done?" });
    expect(dialog).toHaveTextContent(
      "Nothing is in this state. It will be deleted immediately.",
    );
    expect(within(dialog).queryByRole("combobox", { name: "Move work items to" }))
      .not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete state" }))
      .toBeInTheDocument();
  });

  it("keeps protected states blocked in the delete confirmation", async () => {
    workflowApi.getStateImpact.mockResolvedValue({
      state_id: "todo",
      total_work_items: 1,
      protection_rules: [{
        code: "protected_state",
        message: "Todo is protected and cannot be deleted.",
      }],
      valid_replacements: [],
      impact_token: "impact-todo",
    });
    render(<SettingsModal />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Todo" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Todo?" });
    expect(dialog).toHaveTextContent("Todo is protected and cannot be deleted.");
    expect(within(dialog).queryByRole("button", { name: "Delete state" }))
      .not.toBeInTheDocument();
  });

  it("does not show module issue types in workflow settings", async () => {
    render(<SettingsModal />);
    await openIssueTypes();

    expect(screen.queryByRole("tab", { name: "Module" })).not.toBeInTheDocument();
    expect(workflowApi.getIssueTypeWorkflowSettings).not.toHaveBeenCalledWith("module");
  });

  it("renders state launch controls separately from transition disclosures", async () => {
    render(<SettingsModal />);
    await openIssueTypes();

    expect(screen.getByRole("heading", { name: "Todo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("No outgoing transitions.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", {
      name: /Expand .* launch configuration/,
    })).toHaveLength(3);
    expect(screen.queryByRole("button", {
      name: "Remove Todo from workflow",
    })).not.toBeInTheDocument();
    const removeReview = screen.getByRole("button", {
      name: "Remove Review from workflow",
    });
    expect(removeReview).not.toHaveClass("opacity-0");

    const transition = screen.getByRole("listitem", {
      name: "Review to Done transition",
    });
    expect(transition).toHaveTextContent("Agents + people");
    expect(transition).not.toHaveTextContent("Auto-start");
    expect(transition).not.toHaveTextContent("Run subtree");
    expect(transition).not.toHaveTextContent("claude · sonnet");
    expect(screen.queryByText("Edit launch")).not.toBeInTheDocument();

    fireEvent.click(within(transition).getByRole("button", {
      name: "Expand Review to Done",
    }));
    expect(within(transition).getByRole("region", {
      name: "Review to Done transition properties",
    })).toBeInTheDocument();
    expect(within(transition).queryByRole("region", {
      name: "Done on entry",
    })).not.toBeInTheDocument();
    expect(within(transition).queryByRole("form")).not.toBeInTheDocument();
    expect(within(transition).getByRole("checkbox", {
      name: "Agents may move Review to Done",
    })).toBeChecked();

    fireEvent.click(screen.getByRole("button", {
      name: "Expand Done launch configuration",
    }));
    const doneState = screen.getByRole("listitem", {
      name: "Done workflow state",
    });
    expect(within(doneState).getByRole("region", {
      name: "Done on entry",
    })).toBeInTheDocument();
    expect(within(doneState).getByRole("form", {
      name: "Story · Done launch configuration",
    })).toBeInTheDocument();

    workflowApi.previewIssueTypeWorkflowImpact.mockResolvedValueOnce({
      workflow_revision: 7,
      deleted_transitions: [
        { from_state_id: "review", to_state_id: "done", agent_allowed: true },
      ],
      deleted_launch_bindings: [],
      disabled_auto_start_state_ids: [],
    });
    fireEvent.click(within(transition).getByRole("button", {
      name: "Remove transition Review to Done",
    }));
    expect(await screen.findByRole("dialog", {
      name: "Workflow deletion impact",
    })).toHaveTextContent("Transition: Review → Done");
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(workflowApi.removeIssueTypeWorkflowTransition)
      .toHaveBeenCalledWith("story", "review", "done", 7));
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

    fireEvent.click(screen.getByRole("button", { name: "Expand Review to Done" }));
    fireEvent.click(screen.getByRole("checkbox", {
      name: "Agents may move Review to Done",
    }));
    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowTransitionPermission)
      .toHaveBeenCalledWith("story", "review", "done", false, 8));
  });

  it("gates auto-start on valid launch configuration and applies launch edits", async () => {
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", {
      name: "Expand Review launch configuration",
    }));

    expect(screen.getByRole("checkbox", { name: "Auto-start Review" })).toBeDisabled();
    const form = screen.getByRole("form", { name: "Story · Review launch configuration" });
    expect(within(form).getByRole("textbox", { name: "Prompt" }))
      .toHaveAttribute("rows", "4");
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
    fireEvent.click(screen.getByRole("button", {
      name: "Expand Review launch configuration",
    }));

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

  it("adds a destination inline from its source and focuses the filtered picker", async () => {
    workflowApi.addIssueTypeWorkflowTransition.mockResolvedValue(nextWorkflow({
      transitions: [
        ...baseWorkflow.transitions,
        { from_state_id: "todo", to_state_id: "idea", agent_allowed: true },
      ],
    }));
    render(<SettingsModal />);
    await openIssueTypes();

    expect(screen.queryByRole("combobox", { name: "Add state to workflow" }))
      .not.toBeInTheDocument();
    const todoState = screen.getByRole("listitem", {
      name: "Todo workflow state",
    });
    const outgoing = within(todoState).getByRole("list", {
      name: "Todo outgoing transitions",
    });
    const addDestination = screen.getByRole("button", {
      name: "Add transition from Todo",
    });
    expect(
      outgoing.compareDocumentPosition(addDestination)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    fireEvent.click(addDestination);
    const picker = screen.getByRole("combobox", {
      name: "Add destination from Todo",
    });
    expect(picker).toHaveFocus();
    expect(within(picker).getByRole("option", { name: "Idea" })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: "Review" }))
      .not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "idea" } });
    fireEvent.click(screen.getByRole("button", {
      name: "Create transition from Todo",
    }));

    await waitFor(() => expect(workflowApi.addIssueTypeWorkflowTransition)
      .toHaveBeenCalledWith("story", {
        from_state_id: "todo",
        to_state_id: "idea",
        agent_allowed: true,
        workflow_revision: 7,
      }));
    await waitFor(() => expect(screen.getByRole("listitem", {
      name: "Todo to Idea transition",
    })).toBeInTheDocument());
  });

  it("renders one state launch configuration for a shared destination", async () => {
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([
      {
        agent: "claude",
        accepts_model: true,
        accepts_any_model: false,
        model_aliases: ["sonnet"],
        model_prefixes: [],
        reasoning_levels: ["high"],
      },
      {
        agent: "codex",
        accepts_model: true,
        accepts_any_model: true,
        model_aliases: [],
        model_prefixes: [],
        reasoning_levels: ["medium"],
      },
    ]);
    workflowApi.getIssueTypeWorkflowSettings.mockResolvedValue({
      ...structuredClone(baseWorkflow),
      transitions: [
        ...baseWorkflow.transitions,
        { from_state_id: "todo", to_state_id: "done", agent_allowed: false },
      ],
      launch_bindings: [{
        ...baseWorkflow.launch_bindings[0],
        auto_start: true,
        subtree_run_enabled: true,
      }],
    });
    render(<SettingsModal />);
    await openIssueTypes();

    const transition = screen.getByRole("listitem", {
      name: "Todo to Done transition",
    });
    expect(transition).toHaveTextContent("People only");
    expect(transition).not.toHaveTextContent("Auto-start");
    expect(transition).not.toHaveTextContent("Run subtree");
    fireEvent.click(screen.getByRole("button", {
      name: "Expand Done launch configuration",
    }));
    const forms = screen.getAllByRole("form", {
      name: "Story · Done launch configuration",
    });
    expect(forms).toHaveLength(1);
    const form = forms[0];
    expect(screen.getByRole("checkbox", { name: "Auto-start Done" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Run subtree Done" })).toBeChecked();
    const provider = within(form).getByRole("combobox", {
      name: "Agent/provider",
    });
    fireEvent.change(provider, { target: { value: "codex" } });
    expect(within(form).getByRole("combobox", { name: "Model" })).toHaveValue("");
    expect(within(form).queryByRole("option", {
      name: "high (unsupported)",
    })).not.toBeInTheDocument();
    await waitFor(() => expect(workflowApi.upsertIssueTypeWorkflowLaunchBinding)
      .toHaveBeenLastCalledWith("story", "done", expect.objectContaining({
        agent: "codex",
        model: null,
        reasoning: null,
      }), 7));
  });

  it("shows a rejected edit inline on the touched control", async () => {
    workflowApi.setIssueTypeWorkflowTransitionPermission.mockRejectedValueOnce(
      new ApiError(422, "Human-only transition is required.", {
        detail: "Human-only transition is required.",
      }),
    );
    render(<SettingsModal />);
    await openIssueTypes();
    fireEvent.click(screen.getByRole("button", { name: "Expand Todo to Review" }));
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
    fireEvent.click(screen.getByRole("button", {
      name: "Expand Review launch configuration",
    }));
    const prompt = screen.getByRole("textbox", { name: "Prompt" });
    fireEvent.change(prompt, { target: { value: "Keep this draft text." } });
    fireEvent.blur(prompt);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Workflow changed elsewhere. Latest settings loaded.",
    );
    const scrollContainer = screen.getByTestId("settings-scroll-container");
    expect(scrollContainer).not.toContainElement(screen.getByRole("status"));
    expect(workflowApi.getIssueTypeWorkflowSettings).toHaveBeenCalledTimes(2);
    expect(prompt).toHaveValue("Keep this draft text.");
  });
});
