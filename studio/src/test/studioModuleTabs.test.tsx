import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RunRecord } from "@worktracker/typescript-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchStatusFrame } from "../features/agents/status/statusFeed";
import { useAgentStatusStore } from "../features/agents/status";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { ModulesPane } from "../app/shell/sidebar/modules/ModulesPane";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useStudioStore } from "../features/projects/store";
import { getModulesSnapshot, seedModules as seedProjectModules } from "../features/projects";
import { getConfigSnapshot as getStudioConfigSnapshot, seedConfig as seedStudioConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { StudioLayout } from "../app/shell/StudioLayout";
import { ModalHost, useModalStore } from "../app/modal";

vi.mock("../features/agents/lifecycle", () => ({
  AgentStateBadge: () => null,
  AutomationFailureChicklet: () => null,
  ScratchStateBadge: () => null,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const PanelGroup = React.forwardRef<
    { setLayout: (sizes: number[]) => void },
    { children: React.ReactNode; className?: string }
  >(({ children, className }, ref) => {
    React.useImperativeHandle(ref, () => ({ setLayout: () => undefined }));
    return <div className={className}>{children}</div>;
  });
  const Panel = React.forwardRef<
    Record<string, never>,
    {
      children: React.ReactNode;
      "data-testid"?: string;
      defaultSize?: number;
      minSize?: number;
      collapsible?: boolean;
    }
  >(
    ({ children, "data-testid": testId, defaultSize, minSize, collapsible }, ref) => {
      React.useImperativeHandle(ref, () => ({}));
      return (
        <div
          data-testid={testId}
          data-default-size={defaultSize}
          data-min-size={minSize}
          data-collapsible={collapsible}
        >
          {children}
        </div>
      );
    },
  );
  const PanelResizeHandle = ({
    children,
    className,
    style,
  }: {
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <div
      className={className}
      data-testid="pane-resize-handle"
      style={style}
    >
      {children}
    </div>
  );
  return {
    Panel,
    PanelGroup,
    PanelResizeHandle,
    disableGlobalCursorStyles: vi.fn(),
  };
});

const fetchMock = vi.fn();
const scrollIntoView = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function workItem(id: string, name: string, moduleId: string) {
  return {
    id,
    key: `CODIN-${id}`,
    name,
    project_id: "project-1",
    sequence_id: 1182,
    state: { id: "todo", name: "Todo", group: "backlog", color: null },
    description: null,
    parent_id: moduleId,
    sub_issues_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function run(
  runId: string,
  taskId: string | null,
  moduleId: string,
  state: RunRecord["state"] = "working",
  updatedAt = "2026-07-17T10:00:00Z",
): RunRecord {
  return {
    agent_run_id: runId,
    task_id: taskId,
    module_id: moduleId,
    scope: "task",
    state,
    updated_at: updatedAt,
  };
}

function localProfile() {
  return {
    name: "Local",
    workspace_slug: "meml",
    agent_prompt: null,
    agent_prompts: {},
    module_folders: {},
    recent_project_id: "project-1",
    recent_module_ids: { "project-1": "module-middle" },
  };
}

function mockModuleCreation({
  folderPutFailures = 0,
}: {
  folderPutFailures?: number;
} = {}) {
  let folderPutCount = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/work-tracker/projects/project-1/issue-types") {
      return Promise.resolve(
        jsonResponse([{ id: "module-type", name: "Module", level: "module" }]),
      );
    }
    if (
      url === "/api/work-tracker/projects/project-1/modules" &&
      init?.method === "POST"
    ) {
      return Promise.resolve(
        jsonResponse({
          id: "module-new",
          name: "New module",
          project_id: "project-1",
        }),
      );
    }
    if (url === "/api/work-tracker/projects/project-1/modules") {
      return Promise.resolve(
        jsonResponse([
          {
            id: "module-new",
            name: "New module",
            project_id: "project-1",
          },
          ...useTasksStore.getState().modules,
        ]),
      );
    }
    if (url === "/api/runs/module-activity?project_id=project-1") {
      return Promise.resolve(jsonResponse({}));
    }
    if (url === "/api/config/profiles/0" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      const isFolderWrite =
        body.module_folders?.["module-new"] !== undefined;
      if (isFolderWrite) folderPutCount += 1;
      if (isFolderWrite && folderPutCount <= folderPutFailures) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "save failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          recent_profile_index: 0,
          profiles: [body],
        }),
      );
    }
    if (url.endsWith("/modules/module-new/work-items")) {
      return Promise.resolve(jsonResponse([]));
    }
    if (url.endsWith("/projects/project-1/states")) {
      return Promise.resolve(jsonResponse([]));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("Studio module tab strip", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    scrollIntoView.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    seedStudioConfig({
      profiles: [],
      recentProfileIndex: null,
      features: { sidebar: true, projects: true },
    });
    useStudioStore.setState({ selectedProjectId: null });
    useModalStore.setState({ modalStack: [], activeBindings: null });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {},
      byTask: {},
      automationAttempts: {},
      automationByTask: {},
    });
    useUIStore.setState({
      focusedPane: "modules",
      sidebarVisible: true,
      expandedTaskIds: new Set(),
      expandedModuleId: null,
      collapsedStateNames: new Set(),
      panelLayout: [18, 18, 36, 28],
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      modules: [
        { id: "module-recent", name: "Recently active", project_id: "project-1" },
        { id: "module-middle", name: "Middle module", project_id: "project-1" },
        { id: "module-old", name: "Old module", project_id: "project-1" },
      ],
      selectedModuleId: "module-middle",
      tasks: [],
      states: [],
      subtasks: {},
      selectedTaskId: null,
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

  it("renders the loaded module order and marks the selected module active", () => {
    render(<ModuleTabStrip />);

    const tabs = within(screen.getByRole("tablist", { name: "Project modules" }))
      .getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Recently active",
      "Middle module",
      "Old module",
    ]);
    expect(screen.getByRole("tab", { name: "Middle module" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows task-bound and scratch working chicklets only on the matching module tab", () => {
    const tasksBeforeStatus = useTasksStore.getState().tasks;
    render(<ModuleTabStrip />);

    act(() => {
      for (const activeRun of [
        run("task-run", "story-1", "module-middle"),
        run("scratch-run", null, "module-middle"),
        run("input-run", "story-1", "module-middle", "needs_input"),
        run("error-run", null, "module-middle", "error"),
        run("other-module-run", "story-2", "module-old"),
      ]) {
        dispatchStatusFrame({
          v: 1,
          type: "agent_lifecycle",
          run: activeRun,
          at: activeRun.updated_at,
        });
      }
    });

    expect(
      within(screen.getByRole("tab", { name: "Middle module" })).getByLabelText(
        "Agent is actively working",
      ),
    ).toHaveTextContent("▶2");
    expect(
      within(screen.getByRole("tab", { name: "Middle module" })).getByLabelText(
        "Agent is waiting for your input",
      ),
    ).toHaveTextContent("?1");
    expect(
      within(screen.getByRole("tab", { name: "Middle module" })).getByLabelText(
        "Agent session reported an error",
      ),
    ).toHaveTextContent("!1");
    expect(
      within(screen.getByRole("tab", { name: "Old module" })).getByLabelText(
        "Agent is actively working",
      ),
    ).toHaveTextContent("▶1");
    expect(
      within(screen.getByRole("tab", { name: "Recently active" })).queryByLabelText(
        "Agent is actively working",
      ),
    ).not.toBeInTheDocument();
    expect(useTasksStore.getState().tasks).toBe(tasksBeforeStatus);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates module-local chicklets and omits quiet and terminal lifecycle frames", () => {
    const tasksBeforeStatus = useTasksStore.getState().tasks;
    render(<ModuleTabStrip />);

    const dispatchRun = (record: RunRecord) => {
      act(() => {
        dispatchStatusFrame({
          v: 1,
          type: "agent_lifecycle",
          run: record,
          at: record.updated_at,
        });
      });
    };
    const chickletFor = (moduleName: string, label: string) =>
      within(screen.getByRole("tab", { name: moduleName })).queryByLabelText(
        label,
      );

    dispatchRun(run("task-run", "story-1", "module-middle"));
    dispatchRun(run("scratch-run", null, "module-middle"));
    dispatchRun(run("other-run", "story-2", "module-old"));

    expect(chickletFor("Middle module", "Agent is actively working")).toHaveTextContent("▶2");
    expect(chickletFor("Old module", "Agent is actively working")).toHaveTextContent("▶1");

    dispatchRun(
      run(
        "scratch-run",
        null,
        "module-middle",
        "needs_input",
        "2026-07-17T10:01:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent is actively working")).toHaveTextContent("▶1");
    expect(chickletFor("Middle module", "Agent is waiting for your input")).toHaveTextContent("?1");
    expect(chickletFor("Old module", "Agent is actively working")).toHaveTextContent("▶1");

    dispatchRun(
      run(
        "scratch-run",
        null,
        "module-middle",
        "quiet",
        "2026-07-17T10:02:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent is waiting for your input")).not.toBeInTheDocument();
    expect(
      chickletFor(
        "Middle module",
        "No recent activity (heuristic — not a confirmed completion)",
      ),
    ).not.toBeInTheDocument();

    dispatchRun(
      run(
        "task-run",
        "story-1",
        "module-middle",
        "error",
        "2026-07-17T10:03:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent session reported an error")).toHaveTextContent("!1");
    expect(chickletFor("Middle module", "Agent is actively working")).not.toBeInTheDocument();

    dispatchRun(
      run(
        "task-run",
        "story-1",
        "module-middle",
        "exited",
        "2026-07-17T10:04:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent session reported an error")).not.toBeInTheDocument();

    dispatchRun(
      run(
        "scratch-run",
        null,
        "module-middle",
        "needs_input",
        "2026-07-17T10:05:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent is waiting for your input")).toHaveTextContent("?1");

    dispatchRun(
      run(
        "scratch-run",
        null,
        "module-middle",
        "lost",
        "2026-07-17T10:06:00Z",
      ),
    );
    expect(chickletFor("Middle module", "Agent is waiting for your input")).not.toBeInTheDocument();
    expect(chickletFor("Old module", "Agent is actively working")).toHaveTextContent("▶1");
    expect(useTasksStore.getState().tasks).toBe(tasksBeforeStatus);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders an empty strip while the module list is loading", () => {
    useTasksStore.setState((state) => ({
      loading: { ...state.loading, modules: true },
    }));

    render(<ModuleTabStrip />);

    expect(screen.getByRole("tablist", { name: "Project modules" })).toBeEmptyDOMElement();
  });

  it("creates a module from the strip and saves its selected folder in the same flow", async () => {
    const profile = localProfile();
    seedStudioConfig({ profiles: [profile], recentProfileIndex: 0 });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    seedProjectModules("project-1", []);
    mockModuleCreation();
    render(
      <>
        <ModuleTabStrip />
        <ModalHost />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const addDialog = await screen.findByRole("dialog", { name: "Add Module" });
    fireEvent.change(within(addDialog).getByPlaceholderText("Module name"), {
      target: { value: "New module" },
    });
    fireEvent.change(
      within(addDialog).getByPlaceholderText("Local folder (optional)"),
      { target: { value: "/repos/new-module" } },
    );
    fireEvent.click(within(addDialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "New module" })).toHaveAttribute("aria-selected", "true");
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(useTasksStore.getState().selectedModuleId).toBe("module-new");
    expect(getModulesSnapshot("project-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "module-new", project_id: "project-1" }),
      ]),
    );
    expect(getStudioConfigSnapshot().profiles[0]?.module_folders).toEqual({
      "module-new": "/repos/new-module",
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/work-tracker/projects/project-1/modules" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("creates with a blank folder without adding a mapping or follow-up modal", async () => {
    const profile = localProfile();
    seedStudioConfig({ profiles: [profile], recentProfileIndex: 0 });
    mockModuleCreation();
    render(
      <>
        <ModuleTabStrip />
        <ModalHost />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Module" });
    fireEvent.change(within(dialog).getByPlaceholderText("Module name"), {
      target: { value: "New module" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(getStudioConfigSnapshot().profiles[0]?.module_folders).toEqual({});
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/config/profiles/0" &&
          JSON.parse(String((init as RequestInit).body)).module_folders?.[
            "module-new"
          ] !== undefined,
      ),
    ).toBe(false);
  });

  it("retries only folder persistence after the module has been created", async () => {
    const profile = localProfile();
    seedStudioConfig({ profiles: [profile], recentProfileIndex: 0 });
    mockModuleCreation({ folderPutFailures: 1 });
    render(
      <>
        <ModuleTabStrip />
        <ModalHost />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Module" });
    fireEvent.change(within(dialog).getByPlaceholderText("Module name"), {
      target: { value: "New module" },
    });
    fireEvent.change(
      within(dialog).getByPlaceholderText("Local folder (optional)"),
      { target: { value: "/repos/retry" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(
      await within(dialog).findByText(/folder could not be saved/i),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Folder" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/work-tracker/projects/project-1/modules" &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/config/profiles/0" &&
          (init as RequestInit | undefined)?.method === "PUT" &&
          JSON.parse(String((init as RequestInit).body)).module_folders?.[
            "module-new"
          ] !== undefined,
      ),
    ).toHaveLength(2);
  });

  it("opens the same combined Add Module flow from the Modules pane", () => {
    render(<ModulesPane />);

    fireEvent.click(screen.getByRole("button", { name: "+ Add Module" }));

    expect(useModalStore.getState().modalStack).toEqual([
      { type: "add-module" },
    ]);
  });

  it("cancels module creation from the strip without changing the project", async () => {
    render(
      <>
        <ModuleTabStrip />
        <ModalHost />
      </>,
    );
    const previousModules = useTasksStore.getState().modules;

    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Module" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useTasksStore.getState().modules).toEqual(previousModules);
    expect(useTasksStore.getState().selectedModuleId).toBe("module-middle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows only the add affordance when the project has no modules", () => {
    useTasksStore.setState({ modules: [], selectedModuleId: null });

    render(<ModuleTabStrip />);

    const strip = screen.getByRole("tablist", { name: "Project modules" });
    expect(within(strip).queryByRole("tab")).not.toBeInTheDocument();
    const addButton = within(strip).getByRole("button", { name: "Add module" });
    expect(addButton).toHaveTextContent("+");
    expect(within(strip).getAllByRole("button")).toEqual([addButton]);
  });

  it("leaves every tab inactive when there is no active module", () => {
    useTasksStore.setState({ selectedModuleId: null });

    render(
      <>
        <ModuleTabStrip />
        <TasksPane />
      </>,
    );

    expect(
      screen.getAllByRole("tab").every(
        (tab) => tab.getAttribute("aria-selected") === "false",
      ),
    ).toBe(true);
    expect(screen.getByText("No stories")).toBeInTheDocument();
  });

  it("switches modules with the existing selection behavior", async () => {
    const profile = localProfile();
    seedStudioConfig({ profiles: [profile], recentProfileIndex: 0 });
    localStorage.setItem(
      "studio.studio.selectedTaskByModule",
      JSON.stringify({ "module-old": "story-old" }),
    );
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: 0,
            profiles: [JSON.parse(String(init.body))],
          }),
        );
      }
      if (url.endsWith("/modules/module-old/work-items")) {
        return Promise.resolve(jsonResponse([workItem("story-old", "Remembered story", "module-old")]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(
          jsonResponse([
            { id: "todo", name: "Todo", group: "backlog", color: null, sort_order: 0 },
          ]),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(
      <>
        <ModuleTabStrip />
        <TasksPane />
      </>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Old module" }));

    expect(await screen.findByRole("treeitem", { name: /Remembered story/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Old module" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Recently active",
      "Middle module",
      "Old module",
    ]);
    await waitFor(() => {
      expect(useUIStore.getState()).toMatchObject({
        sidebarVisible: false,
        focusedPane: "tasks",
      });
      expect(useTasksStore.getState().selectedTaskId).toBe("story-old");
    });
    const profileWrite = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/config/profiles/0" && init?.method === "PUT",
    );
    expect(profileWrite).toBeDefined();
    const persistedProfile = JSON.parse(String(profileWrite![1]?.body));
    expect(persistedProfile.recent_module_ids).toEqual({
      "project-1": "module-old",
    });
  });

  it("keeps overflow reachable and brings the active full-name tab into view", () => {
    const longName = "A module name long enough to need truncation";
    useTasksStore.setState({
      modules: [
        { id: "module-long", name: longName, project_id: "project-1" },
      ],
      selectedModuleId: "module-long",
    });

    render(<ModuleTabStrip />);

    const strip = screen.getByRole("tablist", { name: "Project modules" });
    const tab = screen.getByRole("tab", { name: longName });
    expect(strip).toHaveClass("overflow-x-auto");
    expect(strip).toHaveClass("[scrollbar-width:none]");
    expect(strip).toHaveClass("[&::-webkit-scrollbar]:hidden");
    expect(tab).toHaveAttribute("title", longName);
    expect(tab).toHaveAttribute("tabindex", "-1");
    expect(tab.firstElementChild).toHaveClass("truncate");
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  });

  it("replaces only the Stories and Workspace headers with one shared strip", () => {
    render(<StudioLayout />);

    const region = screen.getByTestId("module-workspace-region");
    expect(within(region).getByRole("tablist", { name: "Project modules" })).toBeInTheDocument();
    expect(within(region).queryByText("Stories")).not.toBeInTheDocument();
    expect(within(region).queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Modules")).toBeInTheDocument();
  });

  it("does not render the Projects pane or Add Project when the flag is off", () => {
    seedStudioConfig({
      features: { sidebar: true, projects: false },
    });
    useUIStore.setState({ panelLayout: [20, 20, 35, 25] });

    render(<StudioLayout />);

    expect(screen.queryByTestId("pane-projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ Add Project" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("pane-modules")).toHaveAttribute(
      "data-default-size",
      "25",
    );
    expect(
      screen.getByTestId("module-workspace-region").parentElement,
    ).toHaveAttribute("data-default-size", "75");
    expect(screen.getAllByTestId("pane-resize-handle")).toHaveLength(2);
  });

  it("uses the full-width Edit view while preserving dormant sidebar state", async () => {
    const persistedLayout = [15, 25, 35, 25];
    localStorage.setItem("studio.sidebarVisible:v1", "true");
    seedStudioConfig({
      features: { sidebar: false, projects: false },
    });
    useUIStore.setState({
      sidebarVisible: true,
      panelLayout: persistedLayout,
    });

    render(<StudioLayout />);

    expect(screen.queryByTestId("pane-projects")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pane-modules")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("module-workspace-region").parentElement,
    ).toHaveAttribute("data-default-size", "100");
    expect(screen.getAllByTestId("pane-resize-handle")).toHaveLength(1);
    expect(localStorage.getItem("studio.sidebarVisible:v1")).toBe("true");
    expect(useUIStore.getState().panelLayout).toEqual(persistedLayout);

    await act(async () => {
      seedStudioConfig({
        features: { sidebar: true, projects: true },
      });
    });

    expect(screen.getByTestId("pane-projects")).toHaveAttribute(
      "data-default-size",
      "15",
    );
    expect(screen.getByTestId("pane-modules")).toHaveAttribute(
      "data-default-size",
      "25",
    );
    expect(
      screen.getByTestId("module-workspace-region").parentElement,
    ).toHaveAttribute("data-default-size", "60");
    expect(useUIStore.getState().panelLayout).toEqual(persistedLayout);
  });

  it("drives resize cursor behavior through every divider's expanded hover target", () => {
    render(<StudioLayout />);

    const handles = screen.getAllByTestId("pane-resize-handle");
    expect(handles).toHaveLength(3);
    for (const handle of handles) {
      const hoverTarget = handle.firstElementChild;

      expect(handle).toHaveClass("w-px");
      expect(handle).toHaveStyle({ cursor: "col-resize" });
      expect(hoverTarget).not.toBeNull();
      expect(hoverTarget).toHaveStyle({ cursor: "col-resize" });
    }
  });

  it("keeps a persisted zero-width Projects pane above its visible minimum", () => {
    useUIStore.setState({ panelLayout: [0, 18, 44, 38] });

    render(<StudioLayout />);

    expect(screen.getByTestId("pane-projects")).toHaveAttribute(
      "data-default-size",
      "0",
    );
    expect(screen.getByTestId("pane-projects")).toHaveAttribute(
      "data-min-size",
      "10",
    );
    expect(screen.getByTestId("pane-projects")).not.toHaveAttribute(
      "data-collapsible",
    );
  });

  it("shows the recent module as active after project-load restoration", async () => {
    const profile = localProfile();
    seedStudioConfig({ profiles: [profile], recentProfileIndex: 0 });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/work-tracker/projects/project-1/modules") {
        return Promise.resolve(
          jsonResponse([
            { id: "module-recent", name: "Recently active", project_id: "project-1" },
            { id: "module-middle", name: "Middle module", project_id: "project-1" },
            { id: "module-old", name: "Old module", project_id: "project-1" },
          ]),
        );
      }
      if (url === "/api/runs/module-activity?project_id=project-1") {
        return Promise.resolve(
          jsonResponse({
            "module-old": "2026-07-15T00:00:00Z",
            "module-middle": "2026-07-14T00:00:00Z",
          }),
        );
      }
      if (url === "/api/config/profiles/0" && init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({
            recent_profile_index: 0,
            profiles: [JSON.parse(String(init.body))],
          }),
        );
      }
      if (url.endsWith("/modules/module-middle/work-items")) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.endsWith("/projects/project-1/states")) {
        return Promise.resolve(jsonResponse([]));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ModuleTabStrip />);

    await act(() => useTasksStore.getState().selectProject("project-1"));

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Old module",
      "Middle module",
      "Recently active",
    ]);
    expect(screen.getByRole("tab", { name: "Middle module" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
