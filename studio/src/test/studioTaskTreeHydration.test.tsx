import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPane } from "../features/studio/pages/tasks/TasksPane";
import { useConfigStore } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
}));

vi.mock("../features/agents/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/terminal")>()),
  useScratchAgentCount: () => 0,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function workItem(
  id: string,
  name: string,
  parentId: string,
  subIssuesCount: number,
) {
  return {
    id,
    key: `CODIN-${id}`,
    name,
    project_id: "project-1",
    sequence_id: Number(id),
    state: { id: "todo", name: "Todo", group: "backlog", color: null },
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: parentId,
    sub_issues_count: subIssuesCount,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const states = [
  { id: "todo", name: "Todo", group: "backlog", color: null, sort_order: 0 },
];

describe("Studio module task-tree hydration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    useConfigStore.setState({ profiles: [], recentProfileIndex: null });
    useUIStore.setState({
      collapsedStateNames: new Set(),
      expandedTaskIds: new Set(),
      expandedModuleId: "module-1",
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [],
      states: [],
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

  it("migrates the legacy module task selection", async () => {
    const remembered = JSON.stringify({ "module-1": "1" });
    localStorage.setItem("studio.coding.selectedTaskByModule", remembered);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("1", "Remembered story", "module-1", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");

    expect(useTasksStore.getState().selectedTaskId).toBe("1");
    expect(localStorage.getItem("studio.selectedTaskByModule:v1")).toBe(
      remembered,
    );
  });

  it("restores a module's selected task only after its tree loads", async () => {
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ "module-1": "1" }),
    );
    let resolveTasks!: (response: Response) => void;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return new Promise<Response>((resolve) => {
          resolveTasks = resolve;
        });
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const load = useTasksStore.getState().loadTasks("project-1", "module-1");
    expect(useTasksStore.getState().selectedTaskId).toBeNull();

    await vi.waitFor(() => expect(resolveTasks).toBeTypeOf("function"));
    resolveTasks(jsonResponse([workItem("1", "Remembered story", "module-1", 0)]));
    await load;
    render(<TasksPane />);

    expect(
      screen.getByRole("treeitem", { name: /Remembered story/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("reveals a remembered nested task while preserving other expanded branches", async () => {
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ "module-1": "3" }),
    );
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Root story", "module-1", 1),
            workItem("2", "Implementation child", "1", 1),
            workItem("3", "Remembered nested task", "2", 0),
            workItem("4", "Unrelated expanded story", "module-1", 1),
            workItem("5", "Unrelated child", "4", 0),
          ]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      if (url === "/api/settings/expanded_subtasks?module_id=module-1") {
        return Promise.resolve(jsonResponse({ value: ["4"] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().selectModule("module-1");
    render(<TasksPane />);

    expect(
      screen.getByRole("treeitem", { name: /Remembered nested task/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Implementation child/)).toBeInTheDocument();
    expect(screen.getByText(/Unrelated child/)).toBeInTheDocument();
    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set(["1", "2", "4"]),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/modules/module-1/work-items"),
      ),
    ).toHaveLength(1);
  });

  it("remembers task selections independently for each module", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(jsonResponse([workItem("1", "First story", "module-1", 0)]));
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return Promise.resolve(jsonResponse([workItem("2", "Second story", "module-2", 0)]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    const view = render(<TasksPane />);
    fireEvent.click(screen.getByRole("treeitem", { name: /First story/ }));

    useTasksStore.setState({
      selectedModuleId: "module-2",
      selectedTaskId: null,
      tasks: [],
      subtasks: {},
    });
    await useTasksStore.getState().loadTasks("project-1", "module-2");
    fireEvent.click(screen.getByRole("treeitem", { name: /Second story/ }));

    expect(JSON.parse(localStorage.getItem("studio.selectedTaskByModule:v1")!)).toEqual({
      "module-1": "1",
      "module-2": "2",
    });

    useTasksStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: null,
      tasks: [],
      subtasks: {},
    });
    await useTasksStore.getState().loadTasks("project-1", "module-1");
    view.rerender(<TasksPane />);

    expect(
      screen.getByRole("treeitem", { name: /First story/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("restores scratch but rejects a stale task id", async () => {
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ "module-1": "__scratch__", "module-2": "deleted-task" }),
    );
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/modules/") && url.endsWith("/work-items")) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    render(<TasksPane />);
    expect(
      screen.getByRole("treeitem", { name: /Local scratch workspace/ }),
    ).toHaveAttribute("aria-selected", "true");

    useTasksStore.setState({
      selectedModuleId: "module-2",
      selectedTaskId: null,
      tasks: [],
      subtasks: {},
    });
    await useTasksStore.getState().loadTasks("project-1", "module-2");

    expect(useTasksStore.getState().selectedTaskId).toBeNull();
  });

  it("keeps default behavior when task storage is malformed or unavailable", async () => {
    localStorage.setItem("studio.selectedTaskByModule:v1", "not-json");
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(jsonResponse([workItem("1", "Available story", "module-1", 0)]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      useTasksStore.getState().loadTasks("project-1", "module-1"),
    ).resolves.toBeUndefined();
    expect(useTasksStore.getState().selectedTaskId).toBeNull();

    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => useTasksStore.setState({ selectedTaskId: "1" })).not.toThrow();
    await expect(
      useTasksStore.getState().loadTasks("project-1", "module-1"),
    ).resolves.toBeUndefined();
  });

  it("renders every hydrated branch and expands it without a child-list request", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Root story", "module-1", 1),
            workItem("2", "Implementation child", "1", 1),
            workItem("3", "Nested task", "2", 0),
          ]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      if (url.includes("/api/settings/expanded_subtasks")) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    render(<TasksPane />);

    expect(screen.getByText(/Root story/)).toBeInTheDocument();
    expect(screen.queryByText(/Implementation child/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand subtasks" }));
    expect(screen.getByText(/Implementation child/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand subtasks" }));
    expect(screen.getByText(/Nested task/)).toBeInTheDocument();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/work-items"),
      ),
    ).toHaveLength(1);
  });

  it("replaces every child branch when the active module changes", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([
            workItem("1", "Old root", "module-1", 1),
            workItem("2", "Old child", "1", 0),
          ]),
        );
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("4", "New root", "module-2", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    expect(useTasksStore.getState().subtasks).toHaveProperty("1");

    useTasksStore.setState({ selectedModuleId: "module-2" });
    await useTasksStore.getState().loadTasks("project-1", "module-2");

    expect(useTasksStore.getState().tasks.map((task) => task.name)).toEqual([
      "Local scratch workspace",
      "New root",
    ]);
    expect(useTasksStore.getState().subtasks).toEqual({});
  });

  it("ignores a previous module response that arrives after the active module", async () => {
    let resolveOldModule!: (response: Response) => void;
    const oldModuleResponse = new Promise<Response>((resolve) => {
      resolveOldModule = resolve;
    });
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return oldModuleResponse;
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("4", "New root", "module-2", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const oldLoad = useTasksStore.getState().loadTasks("project-1", "module-1");
    useTasksStore.setState({ selectedModuleId: "module-2", tasks: [], subtasks: {} });
    await useTasksStore.getState().loadTasks("project-1", "module-2");

    resolveOldModule(
      jsonResponse([
        workItem("1", "Old root", "module-1", 1),
        workItem("2", "Old child", "1", 0),
      ]),
    );
    await oldLoad;

    expect(useTasksStore.getState().tasks.map((task) => task.name)).toEqual([
      "Local scratch workspace",
      "New root",
    ]);
    expect(useTasksStore.getState().subtasks).toEqual({});
  });

  it("ignores expansion hydration from a module switched away from", async () => {
    let resolveOldExpansions!: (response: Response) => void;
    let resolveActiveTasks!: (response: Response) => void;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("1", "Old root", "module-1", 0)]),
        );
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return new Promise<Response>((resolve) => {
          resolveActiveTasks = resolve;
        });
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      if (url === "/api/settings/expanded_subtasks?module_id=module-1") {
        return new Promise<Response>((resolve) => {
          resolveOldExpansions = resolve;
        });
      }
      if (url === "/api/settings/expanded_subtasks?module_id=module-2") {
        return Promise.resolve(jsonResponse({ value: [] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const oldSelection = useTasksStore.getState().selectModule("module-1");
    await vi.waitFor(() => expect(resolveOldExpansions).toBeTypeOf("function"));

    const activeSelection = useTasksStore.getState().selectModule("module-2");
    await vi.waitFor(() => expect(resolveActiveTasks).toBeTypeOf("function"));
    resolveOldExpansions(jsonResponse({ value: ["old-expanded-branch"] }));
    await oldSelection;

    expect(useTasksStore.getState().selectedModuleId).toBe("module-2");
    expect(useUIStore.getState().expandedTaskIds).not.toContain(
      "old-expanded-branch",
    );

    resolveActiveTasks(
      jsonResponse([workItem("4", "Active root", "module-2", 0)]),
    );
    await activeSelection;
  });

  it("ignores old expansion hydration after switching away and back", async () => {
    let resolveFirstModuleOneExpansions!: (response: Response) => void;
    let moduleOneExpansionRequests = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("1", "Module-one root", "module-1", 0)]),
        );
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("4", "Module-two root", "module-2", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      if (url === "/api/settings/expanded_subtasks?module_id=module-1") {
        moduleOneExpansionRequests += 1;
        if (moduleOneExpansionRequests === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirstModuleOneExpansions = resolve;
          });
        }
        return Promise.resolve(jsonResponse({ value: ["current-branch"] }));
      }
      if (url === "/api/settings/expanded_subtasks?module_id=module-2") {
        return Promise.resolve(jsonResponse({ value: [] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const firstModuleOneSelection = useTasksStore
      .getState()
      .selectModule("module-1");
    await vi.waitFor(() =>
      expect(resolveFirstModuleOneExpansions).toBeTypeOf("function"),
    );
    await useTasksStore.getState().selectModule("module-2");
    await useTasksStore.getState().selectModule("module-1");

    resolveFirstModuleOneExpansions(
      jsonResponse({ value: ["stale-branch"] }),
    );
    await firstModuleOneSelection;

    expect(useUIStore.getState().expandedTaskIds).toEqual(
      new Set(["current-branch"]),
    );
  });

  it("ignores an old response after switching away from and back to its module", async () => {
    let resolveFirstModuleOne!: (response: Response) => void;
    const firstModuleOneResponse = new Promise<Response>((resolve) => {
      resolveFirstModuleOne = resolve;
    });
    let moduleOneRequests = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        moduleOneRequests += 1;
        if (moduleOneRequests === 1) return firstModuleOneResponse;
        return Promise.resolve(
          jsonResponse([
            workItem("5", "Newest module-one root", "module-1", 0),
          ]),
        );
      }
      if (url.endsWith("/modules/module-2/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("4", "Module-two root", "module-2", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const oldModuleOneLoad = useTasksStore
      .getState()
      .loadTasks("project-1", "module-1");
    useTasksStore.setState({ selectedModuleId: "module-2", tasks: [], subtasks: {} });
    await useTasksStore.getState().loadTasks("project-1", "module-2");
    useTasksStore.setState({ selectedModuleId: "module-1", tasks: [], subtasks: {} });
    await useTasksStore.getState().loadTasks("project-1", "module-1");

    resolveFirstModuleOne(
      jsonResponse([
        workItem("1", "Stale module-one root", "module-1", 1),
        workItem("2", "Stale child", "1", 0),
      ]),
    );
    await oldModuleOneLoad;

    expect(useTasksStore.getState().tasks.map((task) => task.name)).toEqual([
      "Local scratch workspace",
      "Newest module-one root",
    ]);
    expect(useTasksStore.getState().subtasks).toEqual({});
  });
});
