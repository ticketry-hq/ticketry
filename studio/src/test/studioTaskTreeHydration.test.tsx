import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import {
  getConfigSnapshot,
  seedConfig,
} from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";
import { useIssueStore } from "../app/shell/ticket-workspace/selected-ticket";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
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
    seedConfig({ profiles: [], recentProfileIndex: null });
    useClientStore.setState({
      collapsedStateIds: new Set(),
      expandedIdsByModule: {},
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
    useIssueStore.setState({
      workItemsById: {},
      workItemIdByKey: {},
      childWorkItemIds: {},
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

  it("hydrates every module descendant into the faithful keyed work-item owner", async () => {
    const parent = {
      ...workItem("1", "Nullable-state story", "module-1", 1),
      state: null,
      is_archived: true,
      blocked_by_ids: ["external-blocker"],
      blocks_ids: ["external-dependent"],
    };
    const child = workItem("2", "Implementation child", "1", 0);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(jsonResponse([parent, child]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(states));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");

    const owner = useIssueStore.getState();
    expect(owner.getWorkItem("1")).toMatchObject({
      state: null,
      is_archived: true,
      blocked_by_ids: ["external-blocker"],
      blocks_ids: ["external-dependent"],
    });
    expect(owner.getWorkItemByKey("CODIN-1")?.id).toBe("1");
    expect(owner.getChildWorkItems("1").map((item) => item.id)).toEqual(["2"]);
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

  it("renders and persists collapse for an empty configured workflow state", async () => {
    const configuredStates = [
      ...states,
      {
        id: "done",
        name: "Done",
        group: "completed",
        color: null,
        sort_order: 1,
      },
    ];
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/modules/module-1/work-items")) {
        return Promise.resolve(
          jsonResponse([workItem("1", "Only Todo story", "module-1", 0)]),
        );
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse(configuredStates));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().loadTasks("project-1", "module-1");
    render(<TasksPane />);

    const sectionHeaders = screen.getAllByRole("button", {
      name: /Collapse (Scratch|Todo|Done)/,
    });
    expect(
      sectionHeaders.map((header) => header.getAttribute("aria-label")),
    ).toEqual(["Collapse Scratch", "Collapse Todo", "Collapse Done"]);
    expect(
      screen.getByRole("button", { name: "Collapse Done" }),
    ).toHaveTextContent("Done0");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Done" }));
    expect(
      screen.getByRole("button", { name: "Expand Done" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("studio.collapsedStates:v2")).toBe(
      JSON.stringify(["done"]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Done" }));
    expect(
      screen.getByRole("button", { name: "Collapse Done" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem("studio.collapsedStates:v2")).toBe("[]");
  });

  it("reveals a remembered nested task while preserving other expanded branches", async () => {
    seedConfig({
      profiles: [
        {
          name: "Local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "module-1", path: "/repos/module-1" },
          ],
          recent_project_id: "project-1",
          recent_module_ids: { "project-1": "module-1" },
        },
      ],
      recentProfileIndex: 0,
    });
    localStorage.setItem(
      "studio.selectedTaskByModule:v1",
      JSON.stringify({ "module-1": "3" }),
    );
    localStorage.setItem(
      "studio.expandedSubtasks:v1",
      JSON.stringify({ "module-1": ["4"] }),
    );
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: 0,
            profiles: [JSON.parse(String(init.body))],
            features: getConfigSnapshot().features,
          }),
        );
      }
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
      throw new Error(`Unexpected request: ${url}`);
    });

    await useTasksStore.getState().selectModule("module-1");
    render(<TasksPane />);

    expect(
      screen.getByRole("treeitem", { name: /Remembered nested task/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Implementation child/)).toBeInTheDocument();
    expect(screen.getByText(/Unrelated child/)).toBeInTheDocument();
    expect(useClientStore.getState().expandedIdsByModule).toEqual({
      "module-1": ["4"],
    });
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

  it("restores and persists expanded branches independently by module", () => {
    localStorage.setItem(
      "studio.expandedSubtasks:v1",
      JSON.stringify({
        "module-1": ["module-one-branch"],
        "module-2": ["module-two-branch"],
      }),
    );

    useClientStore.setState({
      expandedIdsByModule: {
        "module-1": ["module-one-branch"],
        "module-2": ["module-two-branch"],
      },
    });
    useClientStore
      .getState()
      .toggleExpanded("module-2", "new-module-two-branch");

    expect(useClientStore.getState().expandedIdsByModule).toEqual({
      "module-1": ["module-one-branch"],
      "module-2": ["module-two-branch", "new-module-two-branch"],
    });
    expect(JSON.parse(localStorage.getItem("studio.expandedSubtasks:v1")!))
      .toEqual({
        "module-1": ["module-one-branch"],
        "module-2": ["module-two-branch", "new-module-two-branch"],
      });
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
