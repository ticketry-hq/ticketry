import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskSummary, TaskState } from "../features/studio/lib/types";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import {
  isPlanningRow,
  TasksPane,
} from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useTaskTree } from "../app/shell/ticket-workspace/tasks/hooks/useTaskTree";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";
import { TEMP_TASK_ID } from "../features/agents/types";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import type { WorkItem } from "../shared/api/types";
import { setTaskTree } from "../features/studio/stores/taskTreeCache";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

const TODO: TaskState = {
  id: "todo",
  name: "Todo",
  group: "backlog",
  color: "#123456",
  sort_order: 0,
};

const DONE: TaskState = {
  id: "done",
  name: "Done",
  group: "completed",
  color: null,
  sort_order: 1,
};

function story(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "story-alpha",
    name: "Alpha launch",
    project_id: "project-1",
    sequence_id: 201,
    key: "CODING-201",
    state: TODO,
    description: null,
    parent_id: "module-1",
    sub_issues_count: 0,
    ...overrides,
    issue_type: overrides.issue_type ?? { id: "type-story", name: "Story", level: "task" },
  };
}

function visibleStoryNames(): string[] {
  return within(screen.getByRole("tree"))
    .getAllByRole("treeitem")
    .filter((row) => row.getAttribute("data-task-id") !== TEMP_TASK_ID)
    .map((row) => row.textContent ?? "");
}

function seedStories(...items: TaskSummary[]) {
  for (const item of items) {
    queryClient.setQueryData(
      queryKeys.workItems.byId(item.id),
      item as unknown as WorkItem,
    );
  }
}

function KeyboardStoriesPane() {
  const { rows } = useTaskTree();
  useGlobalKeymap(rows);
  return <TasksPane />;
}

describe("Studio Stories search", () => {
  beforeEach(() => {
    queryClient.clear();
    useClientStore.setState({
      collapsedStateIds: new Set(),
      expandedIdsByModule: {},
      storySearchQuery: "",
    });
    const alpha = story();
    const beta = story({
      id: "story-beta",
      name: "Beta follow-up",
      sequence_id: 202,
      key: "CODING-202",
    });
    seedStories(alpha, beta);
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [alpha, beta],
      states: [TODO, DONE],
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

  it("derives id-only work-item rows and a distinct module scratch row", () => {
    const { result } = renderHook(() => useTaskTree());
    const planningRows = result.current.rows.filter(isPlanningRow);

    expect(planningRows[0]).toEqual({ kind: "scratch", moduleId: "module-1" });
    expect(planningRows.slice(1)).toEqual([
      {
        kind: "work-item",
        id: "story-beta",
        depth: 0,
        parentId: null,
        expandable: false,
        expanded: false,
      },
      {
        kind: "work-item",
        id: "story-alpha",
        depth: 0,
        parentId: null,
        expandable: false,
        expanded: false,
      },
    ]);
    expect(planningRows.some((row) => "task" in row || "name" in row)).toBe(false);
  });

  it("resolves the displayed record again when its canonical holding changes", () => {
    render(<TasksPane />);
    expect(screen.getByText("Alpha launch")).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.workItems.byId("story-alpha"), {
        ...story(),
        name: "Alpha renamed",
      } as unknown as WorkItem);
    });

    expect(screen.getByText("Alpha renamed")).toBeInTheDocument();
    expect(screen.queryByText("Alpha launch")).not.toBeInTheDocument();
  });

  it("offers disclosure for unread children but not a known childless row", () => {
    setTaskTree("project-1", "module-1", {
      rootIds: ["story-alpha", "story-beta"],
      children: { "story-beta": [] },
      order: ["story-alpha", "story-beta"],
    });
    render(<TasksPane />);

    const unknown = screen.getByRole("treeitem", { name: /Alpha launch/ });
    const childless = screen.getByRole("treeitem", { name: /Beta follow-up/ });
    expect(
      within(unknown).getByRole("button", { name: "Expand subtasks" }),
    ).toBeInTheDocument();
    expect(within(childless).queryByRole("button")).toBeNull();
  });

  it("renders canonical keys and narrows by key, title, or bare ticket number", () => {
    render(<TasksPane />);

    const search = screen.getByRole("textbox", { name: "Search stories" });
    const ideaEntry = screen.getByRole("textbox", { name: "Capture an idea" });
    const alphaRow = screen.getByRole("treeitem", { name: /Alpha launch/ });
    expect(alphaRow).toHaveTextContent("CODING-201 · Alpha launch");
    const alphaKey = within(alphaRow).getByText("CODING-201");
    expect(alphaKey).toHaveAttribute("data-task-id-token");
    expect(alphaKey).toHaveStyle({ color: "#123456" });
    expect(within(alphaRow).getByText("Alpha launch").parentElement).toHaveClass(
      "min-w-0",
      "truncate",
    );
    expect(
      screen.getByRole("button", { name: "Collapse Done" }),
    ).toHaveTextContent("Done0");
    expect(
      search.compareDocumentPosition(ideaEntry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.change(search, { target: { value: "  coding-202  " } });
    expect(visibleStoryNames()).toEqual([
      expect.stringMatching(/CODING-202 · Beta follow-up/),
    ]);

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
      selectedModuleId: null,
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
    const alpha = story();
    const hidden = story({ id: "story-hidden", name: "Beta hidden", sequence_id: 202 });
    const next = story({ id: "story-next", name: "Alpha follow-up", sequence_id: 203 });
    seedStories(alpha, hidden, next);
    useTasksStore.setState({
      tasks: [alpha, hidden, next],
    });
    render(<KeyboardStoriesPane />);

    const search = screen.getByRole("textbox", { name: "Search stories" });
    const tree = screen.getByRole("tree");

    fireEvent.keyDown(window, { key: "/" });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "alpha" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(
      screen.getByRole("treeitem", { name: /Local scratch workspace/ }),
    ).toHaveFocus();
    expect(useTasksStore.getState().selectedTaskId).toBe(TEMP_TASK_ID);

    fireEvent.keyDown(window, { key: "ArrowDown" });
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
      key: "CODING-302",
      parent_id: root.id,
      sub_issues_count: 2,
    });
    const implementationSibling = story({
      id: "implementation-sibling",
      name: "Unrelated implementation",
      sequence_id: 303,
      parent_id: root.id,
    });
    const taskMatch = story({
      id: "task-match",
      name: "Needle validation",
      sequence_id: 304,
      key: "CODING-304",
      parent_id: matchingParent.id,
    });
    const taskSibling = story({
      id: "task-sibling",
      name: "Unrelated validation",
      sequence_id: 305,
      parent_id: matchingParent.id,
    });
    seedStories(root, matchingParent, implementationSibling, taskMatch, taskSibling);
    useTasksStore.setState({
      tasks: [root],
      subtasks: {
        [root.id]: [
          matchingParent,
          implementationSibling,
        ],
        [matchingParent.id]: [
          taskMatch,
          taskSibling,
        ],
      },
    });
    useClientStore.setState({
      collapsedStateIds: new Set([TODO.id!]),
      expandedIdsByModule: {
        "module-1": [root.id, matchingParent.id],
      },
    });
    render(<TasksPane />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "coding-304" },
    });

    expect(visibleStoryNames()).toEqual([
      expect.stringMatching(/Release work/),
      expect.stringMatching(/CODING-302 · Needle implementation/),
      expect.stringMatching(/CODING-304 · Needle validation/),
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
    expect(useClientStore.getState().collapsedStateIds).toEqual(
      new Set([TODO.id]),
    );
    expect(useClientStore.getState().expandedIdsByModule["module-1"]).toEqual(
      [root.id, matchingParent.id],
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse Todo" }));
    fireEvent.click(
      within(screen.getByRole("treeitem", { name: /Release work/ })).getByRole(
        "button",
        { name: "Collapse subtasks" },
      ),
    );
    expect(useClientStore.getState().collapsedStateIds).toEqual(
      new Set([TODO.id]),
    );
    expect(useClientStore.getState().expandedIdsByModule["module-1"]).toEqual(
      [root.id, matchingParent.id],
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("button", { name: "Expand Todo" }),
    ).toBeInTheDocument();
    expect(visibleStoryNames()).toHaveLength(0);
    expect(useClientStore.getState().collapsedStateIds).toEqual(
      new Set([TODO.id]),
    );
    expect(useClientStore.getState().expandedIdsByModule["module-1"]).toEqual(
      [root.id, matchingParent.id],
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
    const todoOther = story({ id: "todo-other", name: "Other Todo", sequence_id: 402 });
    const doneRoot = story({
      id: "done-root",
      name: "Completed rollout",
      sequence_id: 403,
      state: DONE,
    });
    const todoMatch = story({
      id: "todo-match",
      name: "Find this nested task",
      sequence_id: 404,
      parent_id: todoRoot.id,
    });
    seedStories(todoRoot, todoOther, doneRoot, todoMatch);
    useTasksStore.setState({
      tasks: [
        todoRoot,
        todoOther,
        doneRoot,
      ],
      subtasks: {
        [todoRoot.id]: [
          todoMatch,
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
    seedStories(loadingParent);
    useTasksStore.setState((state) => ({
      tasks: [loadingParent],
      subtasks: {},
      loading: { ...state.loading, subtasks: true },
    }));
    setTaskTree("project-1", "module-1", {
      rootIds: [loadingParent.id],
      children: {},
      order: [loadingParent.id],
    });
    useClientStore.setState({
      expandedIdsByModule: { "module-1": [loadingParent.id] },
    });
    render(<TasksPane />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), {
      target: { value: "alpha" },
    });

    expect(
      screen.getByRole("treeitem", { name: /Local scratch workspace/ }),
    ).toHaveTextContent("Local scratch workspace");
    expect(screen.queryByText(/undefined-|null-/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("treeitem", { name: /Alpha loading branch/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "…" })).toBeInTheDocument();
  });
});
