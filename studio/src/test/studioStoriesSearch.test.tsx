import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSummary, TaskState } from "../features/studio/lib/types";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useTaskTree } from "../features/studio/pages/tasks/hooks/useTaskTree";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { TEMP_TASK_ID } from "../features/agents/types";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
}));

vi.mock("../features/agents/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/terminal")>()),
  useScratchAgentCount: () => 0,
}));

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: null,
  sort_order: 0,
};

const DONE: TaskState = {
  id: "done",
  name: "Done",
  group: "completed",
  color: null,
  sort_order: 1,
};

const SCRATCH: TaskState = {
  id: null,
  name: "Scratch",
  group: "backlog",
  color: null,
};

function story(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "story-alpha",
    name: "Alpha launch",
    project_id: "project-1",
    sequence_id: 201,
    state: TODO,
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

function visibleStoryNames(): string[] {
  return within(screen.getByRole("tree"))
    .getAllByRole("treeitem")
    .map((row) => row.textContent ?? "");
}

function KeyboardStoriesPane() {
  const { rows } = useTaskTree();
  useGlobalKeymap(rows);
  return <TasksPane />;
}

describe("Studio Stories search", () => {
  beforeEach(() => {
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(),
      storySearchQuery: "",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [
        story(),
        story({
          id: "story-beta",
          name: "Beta follow-up",
          sequence_id: 202,
        }),
      ],
      states: [SCRATCH, TODO, DONE],
      subtasks: {},
      details: null,
      loading: {
        projects: false,
        modules: false,
        tasks: false,
        details: false,
        subtasks: false,
      },
    });
  });

  it("narrows by title or displayed ticket number and clears back to every Story", () => {
    render(<TasksPane />);

    const search = screen.getByRole("textbox", { name: "Search stories" });
    const ideaEntry = screen.getByRole("textbox", { name: "Capture an idea" });
    expect(
      screen.getByRole("button", { name: "Collapse Done" }),
    ).toHaveTextContent("Done0");
    expect(
      search.compareDocumentPosition(ideaEntry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(search, { target: { value: "  ALPHA  " } });
    expect(visibleStoryNames()).toEqual([expect.stringMatching(/Alpha launch/)]);
    expect(
      screen.queryByRole("button", { name: "Collapse Done" }),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "202" } });
    expect(visibleStoryNames()).toEqual([
      expect.stringMatching(/Beta follow-up/),
    ]);

    fireEvent.change(search, { target: { value: "   " } });
    expect(visibleStoryNames()).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Collapse Done" }),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(visibleStoryNames()).toHaveLength(2);
  });

  it("keeps the empty-pane message when there are genuinely no task rows", () => {
    useTasksStore.setState({
      tasks: [],
      states: [TODO, DONE],
    });

    render(<TasksPane />);

    expect(screen.getByText("No stories")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.queryByText(TODO.name)).not.toBeInTheDocument();
    expect(screen.queryByText(DONE.name)).not.toBeInTheDocument();
  });

  it("hands keyboard focus between search and only the visible Story rows", () => {
    Element.prototype.scrollIntoView = vi.fn();
    useTasksStore.setState({
      tasks: [
        story(),
        story({ id: "story-hidden", name: "Beta hidden", sequence_id: 202 }),
        story({ id: "story-next", name: "Alpha follow-up", sequence_id: 203 }),
      ],
    });
    render(<KeyboardStoriesPane />);

    const search = screen.getByRole("textbox", { name: "Search stories" });
    const tree = screen.getByRole("tree");

    fireEvent.keyDown(window, { key: "/" });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "alpha" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(
      screen.getByRole("treeitem", { name: /Alpha follow-up/ }),
    ).toHaveFocus();
    expect(useTasksStore.getState().selectedTaskId).toBe("story-next");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useTasksStore.getState().selectedTaskId).toBe("story-alpha");
    expect(screen.queryByText("Beta hidden")).not.toBeInTheDocument();

    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(tree).toHaveFocus();
    expect(visibleStoryNames()).toHaveLength(3);
  });

  it("reveals a matching descendant chain without changing collapsed groups or parents", () => {
    const root = story({
      id: "story-root",
      name: "Release work",
      sequence_id: 301,
      sub_issues_count: 2,
    });
    const matchingParent = story({
      id: "implementation-match",
      name: "Needle implementation",
      sequence_id: 302,
      parent_id: root.id,
      sub_issues_count: 2,
    });
    useTasksStore.setState({
      tasks: [root],
      subtasks: {
        [root.id]: [
          matchingParent,
          story({
            id: "implementation-sibling",
            name: "Unrelated implementation",
            sequence_id: 303,
            parent_id: root.id,
          }),
        ],
        [matchingParent.id]: [
          story({
            id: "task-match",
            name: "Needle validation",
            sequence_id: 304,
            parent_id: matchingParent.id,
          }),
          story({
            id: "task-sibling",
            name: "Unrelated validation",
            sequence_id: 305,
            parent_id: matchingParent.id,
          }),
        ],
      },
    });
    useUIStore.setState({
      collapsedStateNames: new Set([TODO.name]),
      expandedTaskIds: new Set([root.id, matchingParent.id]),
    });
    render(<TasksPane />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "needle" },
    });

    expect(visibleStoryNames()).toEqual([
      expect.stringMatching(/Release work/),
      expect.stringMatching(/Needle implementation/),
      expect.stringMatching(/Needle validation/),
    ]);
    expect(
      screen.queryByText("Unrelated implementation"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated validation")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Todo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /Release work/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: /Needle implementation/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(useUIStore.getState().collapsedStateNames).toEqual(
      new Set([TODO.name]),
    );
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set([root.id, matchingParent.id]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse Todo" }));
    fireEvent.click(
      within(screen.getByRole("treeitem", { name: /Release work/ })).getByRole(
        "button",
        { name: "Collapse subtasks" },
      ),
    );
    expect(useUIStore.getState().collapsedStateNames).toEqual(
      new Set([TODO.name]),
    );
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set([root.id, matchingParent.id]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("button", { name: "Expand Todo" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
    expect(useUIStore.getState().collapsedStateNames).toEqual(
      new Set([TODO.name]),
    );
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set([root.id, matchingParent.id]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Todo" }));
    expect(
      screen.getByRole("treeitem", { name: /Release work/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: /Needle implementation/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Unrelated implementation")).toBeInTheDocument();
    expect(screen.getByText("Unrelated validation")).toBeInTheDocument();
  });

  it("hides empty state groups while keeping each visible group's unfiltered total", () => {
    const todoRoot = story({
      id: "todo-root",
      name: "Todo root",
      sequence_id: 401,
      sub_issues_count: 1,
    });
    useTasksStore.setState({
      tasks: [
        todoRoot,
        story({ id: "todo-other", name: "Other Todo", sequence_id: 402 }),
        story({
          id: "done-root",
          name: "Completed rollout",
          sequence_id: 403,
          state: DONE,
        }),
      ],
      subtasks: {
        [todoRoot.id]: [
          story({
            id: "todo-match",
            name: "Find this nested task",
            sequence_id: 404,
            parent_id: todoRoot.id,
          }),
        ],
      },
    });
    render(<TasksPane />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "nested" },
    });

    const todoHeader = screen.getByRole("button", { name: "Collapse Todo" });
    expect(within(todoHeader).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(DONE.name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText(DONE.name)).toBeInTheDocument();
    expect(visibleStoryNames()).toHaveLength(3);
  });

  it("keeps the Scratch workspace and active loading placeholder during search", () => {
    const loadingParent = story({
      id: "loading-parent",
      name: "Alpha loading branch",
      sequence_id: 501,
      sub_issues_count: 1,
    });
    useTasksStore.setState((state) => ({
      tasks: [
        story({
          id: TEMP_TASK_ID,
          name: "Local scratch workspace",
          sequence_id: null,
          state: SCRATCH,
          parent_id: null,
        }),
        loadingParent,
      ],
      subtasks: {},
      loading: { ...state.loading, subtasks: true },
    }));
    useUIStore.setState({ expandedTaskIds: new Set([loadingParent.id]) });
    render(<TasksPane />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "alpha" },
    });

    expect(
      screen.getByRole("treeitem", { name: /Local scratch workspace/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /Alpha loading branch/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "…" })).toBeInTheDocument();
  });
});
