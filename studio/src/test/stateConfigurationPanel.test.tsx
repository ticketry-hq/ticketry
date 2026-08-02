import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateConfigurationPanel } from "../features/workflows/StateConfigurationPanel";
import { useWorkflowEditorStore } from "../features/workflows/workflowEditorStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { ApiError } from "../shared/api/client";
import type { ScopedWorkflowSettings } from "../shared/api/types";

const workflowApi = vi.hoisted(() => ({
  getIssueTypes: vi.fn(),
  getStates: vi.fn(),
  getProjectWorkItems: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
  getIssueTypeWorkflowSettings: vi.fn(),
  setIssueTypeWorkflowTransitionPermission: vi.fn(),
  setIssueTypeWorkflowAutoStart: vi.fn(),
  setIssueTypeWorkflowSubtreeRun: vi.fn(),
  upsertIssueTypeWorkflowLaunchBinding: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  ...workflowApi,
}));

const review = {
  id: "review",
  name: "Review",
  group: "started",
  color: "#f59e0b",
  sort_order: 1,
};

const done = {
  id: "done",
  name: "Done",
  group: "completed",
  color: "#22c55e",
  sort_order: 2,
};

const storyWorkflow: ScopedWorkflowSettings = {
  issue_type_id: "story",
  start_state_id: "todo",
  workflow_revision: 7,
  transitions: [
    { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
    { from_state_id: "review", to_state_id: "done", agent_allowed: false },
  ],
  launch_bindings: [{
    state_id: "review",
    prompt: "Review Story work.",
    required_skills: [],
    agent: "claude",
    model: "sonnet",
    reasoning: "high",
    auto_start: false,
    subtree_run_enabled: false,
  }],
  warnings: [],
};

const implementationWorkflow: ScopedWorkflowSettings = {
  issue_type_id: "implementation",
  start_state_id: "todo",
  workflow_revision: 12,
  transitions: [
    { from_state_id: "todo", to_state_id: "review", agent_allowed: true },
    { from_state_id: "review", to_state_id: "done", agent_allowed: false },
  ],
  launch_bindings: [{
    state_id: "review",
    prompt: "Review implementation work.",
    required_skills: [],
    agent: "claude",
    model: "opus",
    reasoning: "medium",
    auto_start: false,
    subtree_run_enabled: false,
  }],
  warnings: [],
};

function renderPanel() {
  return render(<StateConfigurationPanel state={review} onClose={vi.fn()} />);
}

describe("State configuration launch binding editor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTasksStore.setState({ selectedProjectId: "project-1" });
    useWorkflowEditorStore.setState({
      projectId: null,
      issueTypes: [],
      states: [],
      stateWorkItemCounts: {},
      providerCapabilities: [],
      selectedTypeId: null,
      workflows: {},
      stagedStateIds: {},
      loading: false,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
    workflowApi.getIssueTypes.mockResolvedValue([
      { id: "module", name: "Module", level: "module", sort_order: 0 },
      { id: "story", name: "Story", level: "task", sort_order: 2 },
      { id: "implementation", name: "Implementation", level: "task", sort_order: 1 },
    ]);
    workflowApi.getStates.mockResolvedValue([
      { id: "todo", name: "Todo", group: "unstarted", color: "#64748b", sort_order: 0 },
      review,
      done,
    ]);
    workflowApi.getProjectWorkItems.mockResolvedValue([]);
    workflowApi.getLaunchProviderCapabilities.mockResolvedValue([{
      agent: "claude",
      accepts_model: true,
      accepts_any_model: false,
      model_aliases: ["sonnet", "opus"],
      model_prefixes: [],
      reasoning_levels: ["medium", "high"],
    }]);
    workflowApi.getIssueTypeWorkflowSettings.mockImplementation((typeId: string) =>
      Promise.resolve(typeId === "story" ? structuredClone(storyWorkflow) :
        structuredClone(implementationWorkflow)));
    workflowApi.upsertIssueTypeWorkflowLaunchBinding.mockResolvedValue({
      ...structuredClone(storyWorkflow),
      workflow_revision: 8,
    });
    workflowApi.setIssueTypeWorkflowTransitionPermission.mockResolvedValue({
      ...structuredClone(storyWorkflow),
      workflow_revision: 8,
      transitions: storyWorkflow.transitions.map((edge) => ({
        ...edge,
        agent_allowed: edge.to_state_id === "review" ? false : edge.agent_allowed,
      })),
    });
    workflowApi.setIssueTypeWorkflowAutoStart.mockResolvedValue({
      ...structuredClone(storyWorkflow),
      workflow_revision: 8,
      launch_bindings: storyWorkflow.launch_bindings.map((binding) => ({
        ...binding,
        auto_start: true,
      })),
    });
    workflowApi.setIssueTypeWorkflowSubtreeRun.mockResolvedValue({
      ...structuredClone(storyWorkflow),
      workflow_revision: 8,
      launch_bindings: storyWorkflow.launch_bindings.map((binding) => ({
        ...binding,
        subtree_run_enabled: true,
      })),
    });
  });

  it("offers only eligible task types, defaults to Story, and resets the form for a type pair", async () => {
    renderPanel();

    const form = await screen.findByRole("form", {
      name: "Story · Review launch configuration",
    });
    const typePicker = screen.getByRole("tablist", { name: "Issue types" });
    expect(within(typePicker).getAllByRole("tab").map((option) => option.textContent))
      .toEqual(["Implementation", "Story"]);
    expect(within(typePicker).queryByRole("tab", { name: "Module" }))
      .not.toBeInTheDocument();
    expect(within(typePicker).getByRole("tab", { name: "Story" }))
      .toHaveAttribute("aria-selected", "true");
    expect(within(form).getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("Review Story work.");
    expect(within(form).getByRole("textbox", { name: "Prompt" }))
      .toHaveAttribute("rows", "14");

    fireEvent.click(within(typePicker).getByRole("tab", {
      name: "Implementation",
    }));
    const implementationForm = await screen.findByRole("form", {
      name: "Implementation · Review launch configuration",
    });
    expect(within(implementationForm).getByRole("textbox", { name: "Prompt" }))
      .toHaveValue("Review implementation work.");
    expect(within(implementationForm).queryByText("Applying…"))
      .not.toBeInTheDocument();
  });

  it("renders an absent binding empty and upserts the first prompt edit with its current revision", async () => {
    workflowApi.getIssueTypeWorkflowSettings.mockImplementation((typeId: string) =>
      Promise.resolve({
        ...(typeId === "story" ? structuredClone(storyWorkflow) : structuredClone(implementationWorkflow)),
        launch_bindings: [],
      }));
    renderPanel();

    const prompt = await screen.findByRole("textbox", { name: "Prompt" });
    expect(prompt).toHaveValue("");
    fireEvent.change(prompt, { target: { value: "A newly configured prompt." } });
    fireEvent.blur(prompt);

    await waitFor(() => expect(workflowApi.upsertIssueTypeWorkflowLaunchBinding)
      .toHaveBeenCalledWith("story", "review", {
        prompt: "A newly configured prompt.",
        agent: null,
        model: null,
        reasoning: null,
      }, 7));
  });

  it("keeps a draft prompt and announces a revision conflict after reloading policy", async () => {
    workflowApi.upsertIssueTypeWorkflowLaunchBinding.mockRejectedValueOnce(
      new ApiError(409, "Stale workflow revision.", { detail: "Stale workflow revision." }),
    );
    renderPanel();

    const prompt = await screen.findByRole("textbox", { name: "Prompt" });
    fireEvent.change(prompt, { target: { value: "Keep this state-panel draft." } });
    fireEvent.blur(prompt);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Workflow changed elsewhere. Latest settings loaded.",
    );
    expect(prompt).toHaveValue("Keep this state-panel draft.");
    expect(workflowApi.getIssueTypeWorkflowSettings).toHaveBeenCalledTimes(3);
  });

  it("keeps a rejected write beside this pair's launch form", async () => {
    workflowApi.upsertIssueTypeWorkflowLaunchBinding.mockRejectedValueOnce(
      new ApiError(422, "This provider is unavailable.", {
        detail: "This provider is unavailable.",
      }),
    );
    renderPanel();

    const prompt = await screen.findByRole("textbox", { name: "Prompt" });
    fireEvent.change(prompt, { target: { value: "Rejected policy." } });
    fireEvent.blur(prompt);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This provider is unavailable.",
    );
  });

  it("shows no write controls when no task workflow reaches the state", async () => {
    workflowApi.getIssueTypeWorkflowSettings.mockImplementation((typeId: string) =>
      Promise.resolve({
        ...structuredClone(storyWorkflow),
        issue_type_id: typeId,
        transitions: [],
      }));
    renderPanel();

    expect(await screen.findByText("No workflow is available for this state."))
      .toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /launch configuration/ }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Issue types" }))
      .not.toBeInTheDocument();
  });

  it("shows every touching transition once and changes its agent permission at the current revision", async () => {
    renderPanel();

    const transitions = await screen.findByRole("region", {
      name: "Review transitions",
    });
    expect(within(transitions).getAllByRole("listitem")).toHaveLength(2);
    expect(within(transitions).getByRole("listitem", { name: "Incoming Todo to Review" }))
      .toHaveTextContent("IncomingTodo → ReviewAgents + people");
    expect(within(transitions).getByRole("listitem", { name: "Outgoing Review to Done" }))
      .toHaveTextContent("OutgoingReview → DonePeople only");

    fireEvent.click(within(transitions).getByRole("checkbox", {
      name: "Agents may move Todo to Review",
    }));

    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowTransitionPermission)
      .toHaveBeenCalledWith("story", "todo", "review", false, 7));
  });

  it("gates Auto-start on a valid binding but allows Run subtree without one", async () => {
    workflowApi.getIssueTypeWorkflowSettings.mockImplementation((typeId: string) =>
      Promise.resolve({
        ...(typeId === "story" ? structuredClone(storyWorkflow) : structuredClone(implementationWorkflow)),
        launch_bindings: [],
      }));
    workflowApi.setIssueTypeWorkflowSubtreeRun.mockResolvedValueOnce({
      ...structuredClone(storyWorkflow),
      workflow_revision: 8,
      launch_bindings: [{
        state_id: "review",
        prompt: "",
        required_skills: [],
        agent: null,
        model: null,
        reasoning: null,
        auto_start: false,
        subtree_run_enabled: true,
      }],
    });
    renderPanel();

    const entry = await screen.findByRole("region", { name: "Review entry automation" });
    expect(within(entry).getByRole("checkbox", { name: "Auto-start Review" }))
      .toBeDisabled();
    const subtree = within(entry).getByRole("checkbox", { name: "Run subtree Review" });
    expect(subtree).toBeEnabled();

    fireEvent.click(subtree);

    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowSubtreeRun)
      .toHaveBeenCalledWith("story", "review", true, 7));
    expect(within(entry).getByRole("checkbox", { name: "Auto-start Review" }))
      .toBeDisabled();
  });

  it("orders all controls on one vertical scrolling page", async () => {
    renderPanel();

    await screen.findByRole("form", { name: "Story · Review launch configuration" });
    const panel = screen.getByTestId("state-configuration-panel");
    const sections = [
      screen.getByRole("region", { name: "Review issue type" }),
      screen.getByRole("region", { name: "Review launch configuration" }),
      screen.getByRole("region", { name: "Review transitions" }),
      screen.getByRole("region", { name: "Review entry automation" }),
    ];
    for (let index = 0; index < sections.length - 1; index += 1) {
      expect(sections[index].compareDocumentPosition(sections[index + 1])
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(panel).toHaveClass("overflow-y-auto");
    expect(panel.querySelectorAll(".overflow-y-auto, .overflow-y-scroll"))
      .toHaveLength(0);
  });

  it("uses the authoritative revision returned by one control for the next write", async () => {
    renderPanel();

    const permission = await screen.findByRole("checkbox", {
      name: "Agents may move Todo to Review",
    });
    fireEvent.click(permission);
    await waitFor(() => expect(permission).not.toBeChecked());

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-start Review" }));

    await waitFor(() => expect(workflowApi.setIssueTypeWorkflowAutoStart)
      .toHaveBeenCalledWith("story", "review", true, 8));
  });

  it("keeps rejected permission and toggle feedback beside their controls without blocking the page", async () => {
    workflowApi.setIssueTypeWorkflowTransitionPermission.mockRejectedValueOnce(
      new ApiError(422, "Choose People only for this protected move.", {
        detail: "Choose People only for this protected move.",
      }),
    );
    workflowApi.setIssueTypeWorkflowSubtreeRun.mockRejectedValueOnce(
      new ApiError(422, "Enable subtree policy for this type first.", {
        detail: "Enable subtree policy for this type first.",
      }),
    );
    renderPanel();

    const incoming = await screen.findByRole("listitem", {
      name: "Incoming Todo to Review",
    });
    fireEvent.click(within(incoming).getByRole("checkbox", {
      name: "Agents may move Todo to Review",
    }));
    expect(await within(incoming).findByRole("alert")).toHaveTextContent(
      "Choose People only for this protected move.",
    );

    const entry = screen.getByRole("region", { name: "Review entry automation" });
    const subtree = within(entry).getByRole("checkbox", { name: "Run subtree Review" });
    expect(subtree).toBeEnabled();
    fireEvent.click(subtree);
    expect(await within(entry).findByRole("alert")).toHaveTextContent(
      "Enable subtree policy for this type first.",
    );
    expect(screen.getByRole("checkbox", { name: "Agents may move Review to Done" }))
      .toBeEnabled();
  });
});
