import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToastHost from "../app/shell/ToastHost";
import { useToastStore } from "../app/stores/toastStore";
import { ApiError } from "../shared/api/client";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useOnboardingTourStore } from "../app/onboarding/onboardingTourStore";
import type { TaskSummary } from "../features/studio/lib/types";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useTaskTree } from "../features/studio/pages/tasks/hooks/useTaskTree";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  getIssueTypes: vi.fn(),
}));

vi.mock("../features/studio/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/lib/api")>()),
  createTask: api.createTask,
  getIssueTypes: api.getIssueTypes,
}));

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
}));

vi.mock("../features/agents/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/terminal")>()),
  useScratchAgentCount: () => 0,
}));

const IDEA = {
  id: "state-idea",
  name: "Idea",
  group: "backlog",
  color: null,
  sort_order: 0,
};

function story(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "story-current",
    name: "Current Story",
    project_id: "project-1",
    sequence_id: 41,
    state: IDEA,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function StoriesPaneIntegration({ children }: { children?: React.ReactNode }) {
  const { rows } = useTaskTree();
  useGlobalKeymap(rows);

  return (
    <>
      <TasksPane />
      {children}
      <ToastHost />
    </>
  );
}

function renderStoriesPane(children?: React.ReactNode) {
  return render(
    <StoriesPaneIntegration>{children}</StoriesPaneIntegration>,
  );
}

describe("Studio Stories idea entry", () => {
  beforeEach(() => {
    api.createTask.mockReset();
    api.getIssueTypes.mockReset().mockResolvedValue([
      { id: "type-task", name: "Task", level: "task", is_default: true },
      { id: "type-story", name: "Story", level: "task", is_default: false },
    ]);
    useToastStore.setState({ toasts: [] });
    useOnboardingTourStore.getState().reset();
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(),
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "story-current",
      tasks: [story()],
      states: [IDEA],
      subtasks: {},
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
    });
  });

  it("renders a one-row, auto-growing idea entry before the Story sections", () => {
    renderStoriesPane();

    expect(screen.queryByText("Stories")).not.toBeInTheDocument();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });
    const tree = screen.getByRole("tree");
    expect(entry).toHaveAttribute("rows", "1");
    expect(entry).toHaveClass("resize-none", "overflow-hidden");
    expect(entry.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    Object.defineProperty(entry, "scrollHeight", { value: 96, configurable: true });
    fireEvent.change(entry, { target: { value: "A long idea that wraps onto several rows" } });
    expect(entry).toHaveStyle({ height: "96px" });
  });

  it("joins the Idea entry to Story traversal and preserves its draft on Escape", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderStoriesPane();

    const entry = screen.getByRole("textbox", { name: "Capture an idea" });
    const firstStory = screen.getByRole("treeitem");
    fireEvent.change(entry, { target: { value: "Keep this idea" } });
    firstStory.focus();

    fireEvent.keyDown(firstStory, { key: "ArrowUp" });

    expect(entry).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.keyDown(entry, { key: "ArrowDown" });

    expect(firstStory).toHaveFocus();
    expect(firstStory).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(firstStory, { key: "ArrowUp" });
    fireEvent.keyDown(entry, { key: "Escape" });

    expect(entry).not.toHaveFocus();
    expect(entry).toHaveValue("Keep this idea");
  });

  it("keeps only the keyboard-selected Story visibly identified after a click", () => {
    useTasksStore.setState({
      tasks: [
        story(),
        story({ id: "story-next", name: "Next Story", sequence_id: 42 }),
      ],
    });
    renderStoriesPane();

    const [firstStory, nextStory] = screen.getAllByRole("treeitem");
    fireEvent.click(firstStory);
    firstStory.focus();
    fireEvent.keyDown(firstStory, { key: "ArrowDown" });

    expect(firstStory).toHaveFocus();
    expect(firstStory).toHaveClass("outline-none");
    expect(firstStory).toHaveAttribute("aria-selected", "false");
    expect(nextStory).toHaveAttribute("aria-selected", "true");
    expect(nextStory).toHaveClass("bg-selection-bg");
  });

  it("leaves module-selection focus alone and ignores keys from editable surfaces", async () => {
    useTasksStore.setState({
      tasks: [
        story(),
        story({ id: "story-next", name: "Next Story", sequence_id: 42 }),
      ],
    });
    renderStoriesPane(
      <>
        <input aria-label="Other input" />
        <textarea aria-label="Other textarea" />
        <select aria-label="Other select"><option>One</option></select>
        <div aria-label="Other editable" contentEditable />
      </>,
    );
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });
    const otherInput = screen.getByRole("textbox", { name: "Other input" });

    otherInput.focus();
    useTasksStore.setState({ selectedModuleId: "module-2" });

    await waitFor(() => expect(otherInput).toHaveFocus());
    expect(entry).not.toHaveFocus();

    const editableSurfaces = [
      otherInput,
      screen.getByRole("textbox", { name: "Other textarea" }),
      screen.getByRole("combobox", { name: "Other select" }),
      screen.getByLabelText("Other editable"),
    ];
    for (const editable of editableSurfaces) {
      fireEvent.keyDown(editable, { key: "ArrowDown" });
      expect(useTasksStore.getState().selectedTaskId).toBe("story-current");
    }
  });

  it("trims and creates one explicit Story, then reveals it without changing selection", async () => {
    const pending = deferred<TaskSummary>();
    api.createTask.mockReturnValue(pending.promise);
    useUIStore.setState({ collapsedStateNames: new Set(["Idea"]) });
    useOnboardingTourStore.setState({
      step: "story-create",
      projectId: "project-1",
      moduleId: "module-1",
    });
    renderStoriesPane();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });
    expect(entry).toHaveAttribute("data-coach-anchor", "story-add");
    expect(entry).toHaveAttribute("data-idea-entry", "true");

    entry.focus();
    fireEvent.change(entry, { target: { value: "  Captured idea  " } });
    fireEvent.keyDown(entry, { key: "Enter" });
    fireEvent.keyDown(entry, { key: "Enter" });

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));
    expect(api.getIssueTypes).toHaveBeenCalledWith("project-1");
    expect(api.createTask).toHaveBeenCalledWith(
      "project-1",
      "Captured idea",
      "module-1",
      "type-story",
    );
    expect(entry).toHaveValue("  Captured idea  ");

    pending.resolve(story({ id: "story-new", name: "Captured idea", sequence_id: 42 }));

    await waitFor(() => expect(entry).toHaveValue(""));
    expect(entry).toHaveFocus();
    expect(useTasksStore.getState().selectedTaskId).toBe("story-current");
    expect(useOnboardingTourStore.getState()).toMatchObject({
      step: "handoff",
      storyId: "story-new",
    });
    expect(useUIStore.getState().collapsedStateNames.has("Idea")).toBe(false);
    const rows = within(screen.getByRole("tree")).getAllByRole("treeitem");
    expect(rows[0]).toHaveAttribute("data-task-id", "story-new");
    expect(screen.queryByTestId("toast-success")).not.toBeInTheDocument();
  });

  it("ignores empty and duplicate pending submissions", async () => {
    const pending = deferred<TaskSummary>();
    api.createTask.mockReturnValue(pending.promise);
    renderStoriesPane();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });

    fireEvent.change(entry, { target: { value: "   " } });
    fireEvent.keyDown(entry, { key: "Enter" });
    expect(api.getIssueTypes).not.toHaveBeenCalled();

    fireEvent.change(entry, { target: { value: "One story" } });
    fireEvent.keyDown(entry, { key: "Enter" });
    fireEvent.keyDown(entry, { key: "Enter" });
    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(1));

    pending.resolve(story({ id: "story-new", name: "One story" }));
    await waitFor(() => expect(entry).toHaveValue(""));
  });

  it("does not create an unscoped Story when no module is selected", () => {
    useTasksStore.setState({ selectedModuleId: null });
    renderStoriesPane();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });

    fireEvent.change(entry, { target: { value: "Needs a module" } });
    fireEvent.keyDown(entry, { key: "Enter" });

    expect(api.getIssueTypes).not.toHaveBeenCalled();
    expect(api.createTask).not.toHaveBeenCalled();
    expect(entry).toHaveValue("Needs a module");
  });

  it("retains the draft and focus and shows a useful toast when creation fails", async () => {
    api.createTask.mockRejectedValue(
      new ApiError(422, "HTTP 422", {
        detail: "Story creation is not allowed in this module.",
      }),
    );
    renderStoriesPane();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });

    entry.focus();
    fireEvent.change(entry, { target: { value: "Keep this draft" } });
    fireEvent.keyDown(entry, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Story could not be created: Story creation is not allowed in this module.",
    );
    expect(entry).toHaveValue("Keep this draft");
    expect(entry).toHaveFocus();
  });

  it("clears an unsubmitted draft when the selected module changes", async () => {
    renderStoriesPane();
    const entry = screen.getByRole("textbox", { name: "Capture an idea" });
    fireEvent.change(entry, { target: { value: "Wrong module" } });

    useTasksStore.setState({ selectedModuleId: "module-2" });

    await waitFor(() => expect(entry).toHaveValue(""));
    expect(api.createTask).not.toHaveBeenCalled();
  });
});
