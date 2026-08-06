import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalHost, useModalStore } from "../app/modal";
import { StudioFooter } from "../app/shell/StudioFooter";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import type {
  ModuleSummary,
  TaskSummary,
} from "../features/studio/lib/types";
import type { Row } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { seedConfig as seedStudioConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useClientStore } from "../state/clientStore";
import { TEMP_TASK_ID } from "../features/agents/types";
import {
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../features/agents/terminal";
import { useTicketWorkspaceStore } from "../app/shell/ticket-workspace/selected-ticket";
import { studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import {
  createBrowserRuntime,
  initializeBrowserRuntime,
  initializeStudioRuntime,
} from "../runtime";

const selectedTask: TaskSummary = {
  id: "task-1",
  name: "Selected task",
  project_id: "project-1",
  sequence_id: 42,
  issue_type: { id: "type-story", name: "Story", level: "task" },
  state: { id: "state-1", name: "Todo", group: "backlog", color: null },
  description: null,
  parent_id: null,
  sub_issues_count: 0,
};

function taskRow(task: TaskSummary): Row {
  return {
    kind: "work-item",
    id: task.id,
    depth: 0,
    parentId: null,
    expandable: false,
    expanded: false,
  };
}

const rows: Row[] = [taskRow(selectedTask)];
const modules: ModuleSummary[] = Array.from({ length: 10 }, (_, index) => ({
  id: `module-${index + 1}`,
  name: `Module ${index + 1}`,
  project_id: "project-1",
}));

function initializeDesktopTestRuntime(): void {
  initializeStudioRuntime({
    ...createBrowserRuntime({ environment: {} }),
    platform: "desktop",
  });
}

function KeymapHarness() {
  useGlobalKeymap(rows);
  return null;
}

function DynamicKeymapHarness({ taskRows }: { taskRows: Row[] }) {
  useGlobalKeymap(taskRows);
  return null;
}

function renderKeymapWithModal() {
  return render(
    <>
      <KeymapHarness />
      <ModalHost />
    </>,
  );
}

describe("Studio task keymap", () => {
  beforeEach(() => {
    studioKeymapRegistry.setOverrides([]);
    useModalStore.setState({ modalStack: [], activeBindings: null });
    useClientStore.setState({
      focusedPane: "tasks",
      editViewZone: "stories",
      sidebarVisible: true,
      modalStack: [],
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "task-1",
      tasks: [selectedTask],
      states: [selectedTask.state],
    });
    seedStudioConfig({
      recentProfileIndex: 0,
      features: { sidebar: true, projects: true },
      profiles: [
        {
          name: "Local",
          workspace_slug: "local",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [{ module_id: "module-1", path: "/workspace" }],
        },
      ],
    });
    useTerminalStore.setState({
      sessions: {},
      sessionByRun: {},
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({
      byTaskId: {},
      activeByTask: {},
      chatByDoc: {},
    });
    useTicketWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    initializeBrowserRuntime();
  });

  it("keeps one listener pair while routing with the latest task rows", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const nextTask = {
      ...selectedTask,
      id: "task-2",
      name: "Next task",
      sequence_id: 43,
    };
    const { rerender, unmount } = render(
      <DynamicKeymapHarness taskRows={rows} />,
    );

    rerender(
      <DynamicKeymapHarness taskRows={[...rows, taskRow(nextTask)]} />,
    );

    expect(
      addEventListener.mock.calls.filter(([event]) => event === "keydown"),
    ).toHaveLength(2);
    expect(
      removeEventListener.mock.calls.filter(([event]) => event === "keydown"),
    ).toHaveLength(0);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useTasksStore.getState().selectedTaskId).toBe("task-2");

    unmount();
    expect(
      removeEventListener.mock.calls.filter(([event]) => event === "keydown"),
    ).toHaveLength(2);
  });

  it("opens the shared AgentPicker with explicit task context on Enter", async () => {
    render(
      <>
        <KeymapHarness />
        <ModalHost />
        <StudioFooter />
      </>,
    );

    fireEvent.keyDown(window, { key: "Enter" });

    expect(await screen.findByText("Select Agent")).toBeInTheDocument();

    expect(useModalStore.getState().modalStack).toEqual([
      {
        type: "agent-picker",
        payload: {
          mode: "open",
          projectId: "project-1",
          moduleId: "module-1",
          taskId: "task-1",
          ticketSeq: 42,
        },
      },
    ]);
  });

  it.each([
    "projects",
    "modules",
    "tasks",
    "details-or-terminal",
  ] as const)(
    "opens the task-scoped AgentPicker on Cmd+Enter from the %s pane",
    async (focusedPane) => {
      useClientStore.setState({ focusedPane });
      renderKeymapWithModal();

      fireEvent.keyDown(window, { key: "Enter", metaKey: true });

      expect(await screen.findByText("Select Agent")).toBeInTheDocument();
      expect(useModalStore.getState().modalStack.at(-1)?.payload).toEqual({
        mode: "open",
        projectId: "project-1",
        moduleId: "module-1",
        taskId: "task-1",
        ticketSeq: 42,
      });
    },
  );

  it.each([
    "projects",
    "modules",
    "tasks",
    "details-or-terminal",
  ] as const)(
    "opens prompt input on Cmd+Shift+Enter from the %s pane",
    (focusedPane) => {
      useClientStore.setState({ focusedPane });
      renderKeymapWithModal();

      fireEvent.keyDown(window, {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      });

      expect(useModalStore.getState().modalStack.at(-1)).toMatchObject({
        type: "prompt-input",
        payload: {
          nextPayload: {
            mode: "open-with-prompt",
            projectId: "project-1",
            moduleId: "module-1",
            taskId: "task-1",
            ticketSeq: 42,
          },
        },
      });
    },
  );

  it("leaves Command launch chords owned by editable controls", () => {
    render(
      <>
        <KeymapHarness />
        <ModalHost />
        <textarea aria-label="Task notes" />
      </>,
    );
    const notes = screen.getByRole("textbox", { name: "Task notes" });

    fireEvent.keyDown(notes, { key: "Enter", metaKey: true });
    fireEvent.keyDown(notes, {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
    });

    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("leaves Cmd+Enter owned by the prompt modal submit action", async () => {
    renderKeymapWithModal();
    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });
    const prompt = await screen.findByPlaceholderText(
      "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
    );
    fireEvent.change(prompt, { target: { value: "Keep modal ownership" } });

    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });

    expect(await screen.findByText("Select Agent")).toBeInTheDocument();
    expect(useModalStore.getState().modalStack.at(-1)).toEqual({
      type: "agent-picker",
      payload: {
        mode: "open-with-prompt",
        projectId: "project-1",
        moduleId: "module-1",
        taskId: "task-1",
        ticketSeq: 42,
        initialPrompt: "Keep modal ownership",
      },
    });
  });

  it.each([null, TEMP_TASK_ID, "missing-task"])(
    "does nothing on Command launch chords without a valid real selected task (%s)",
    (selectedTaskId) => {
      useTasksStore.setState({ selectedTaskId });
      renderKeymapWithModal();

      fireEvent.keyDown(window, { key: "Enter", metaKey: true });
      fireEvent.keyDown(window, {
        key: "Enter",
        metaKey: true,
        shiftKey: true,
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(useModalStore.getState().modalStack).toEqual([]);
    },
  );

  it("does not handle task keys while a shared modal owns the keyboard", () => {
    useModalStore.setState({
      modalStack: [{ type: "agent-picker", payload: { mode: "open" } }],
    });
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(useModalStore.getState().modalStack).toHaveLength(1);
  });

  it("focuses Stories search with slash outside editable fields and modals", () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <>
        <KeymapHarness />
        <div data-pane="tasks">
          <input aria-label="Search stories" />
        </div>
        <input aria-label="Other input" />
        <button type="button">Outside control</button>
      </>,
    );

    const search = screen.getByRole("textbox", { name: "Search stories" });
    const otherInput = screen.getByRole("textbox", { name: "Other input" });
    const outsideControl = screen.getByRole("button", { name: "Outside control" });

    fireEvent.keyDown(window, { key: "/" });
    expect(search).toHaveFocus();

    otherInput.focus();
    fireEvent.keyDown(otherInput, { key: "/" });
    expect(otherInput).toHaveFocus();

    useModalStore.setState({
      modalStack: [{ type: "agent-picker", payload: { mode: "open" } }],
    });
    outsideControl.focus();
    fireEvent.keyDown(window, { key: "/" });
    expect(outsideControl).toHaveFocus();
  });

  it("collects additional information before opening AgentPicker on Shift+Enter", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key: "Enter", shiftKey: true });

    const prompt = await screen.findByPlaceholderText(
      "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
    );
    fireEvent.change(prompt, { target: { value: "Check the retry behavior" } });
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });

    expect(await screen.findByText("Select Agent")).toBeInTheDocument();
    expect(useModalStore.getState().modalStack.at(-1)).toEqual({
      type: "agent-picker",
      payload: {
        mode: "open-with-prompt",
        projectId: "project-1",
        moduleId: "module-1",
        taskId: "task-1",
        ticketSeq: 42,
        initialPrompt: "Check the retry behavior",
      },
    });
  });

  it("carries Cmd+Shift+Enter instructions through the selected task launch", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
    });

    const prompt = await screen.findByPlaceholderText(
      "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
    );
    fireEvent.change(prompt, { target: { value: "Check the retry behavior" } });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });

    const pickerTitle = await screen.findByText("Select Agent");
    fireEvent.keyDown(pickerTitle, { key: "Enter" });

    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({
        taskId: "task-1",
        projectId: "project-1",
        moduleId: "module-1",
        ticketSeq: 42,
        initialPrompt: "Check the retry behavior",
      }),
    ]);
    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(useTicketWorkspaceStore.getState().workspaces["task-1"]).toMatchObject({
      active: "terminal",
    });
  });

  it("leaves Command launch chords with terminal typing mode", () => {
    useClientStore.setState({
      sidebarVisible: false,
      editViewZone: "active-tab-body",
      editViewBodyEngaged: true,
    });
    render(
      <>
        <KeymapHarness />
        <div className="xterm" tabIndex={0} />
      </>,
    );
    const terminal = document.querySelector(".xterm") as HTMLElement;

    fireEvent.keyDown(terminal, { key: "Enter", metaKey: true });
    fireEvent.keyDown(terminal, {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
    });

    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("opens the task-scoped agent picker on o", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key: "o" });

    expect(await screen.findByText("Select Agent")).toBeInTheDocument();
    expect(useModalStore.getState().modalStack.at(-1)?.payload).toMatchObject({
      mode: "open",
      projectId: "project-1",
      moduleId: "module-1",
      taskId: "task-1",
      ticketSeq: 42,
    });
  });

  it.each([
    ["n", "plan"],
    ["i", "instant"],
  ])("opens the prompt-first %s flow with launch context", async (key, mode) => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key });

    const prompt = await screen.findByPlaceholderText(
      "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
    );
    expect(prompt).toHaveFocus();
    expect(useModalStore.getState().modalStack.at(-1)?.payload).toMatchObject({
      next: "agent-picker",
      nextPayload: {
        mode,
        projectId: "project-1",
        moduleId: "module-1",
      },
    });
  });

  it.each([
    ["n", "plan"],
    ["i", "instant"],
  ])("selects the scratch workspace after launching from %s", async (key, mode) => {
    renderKeymapWithModal();
    fireEvent.keyDown(window, { key });

    const prompt = await screen.findByPlaceholderText(
      "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
    );
    fireEvent.change(prompt, { target: { value: "Additional context" } });
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    const title = await screen.findByText("Select Agent");
    fireEvent.keyDown(title, { key: "Enter" });

    expect(useTasksStore.getState().selectedTaskId).toBe(TEMP_TASK_ID);
    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({
        taskId: null,
        moduleId: "module-1",
        isPlanning: mode === "plan",
        isInstant: mode === "instant",
      }),
    ]);
  });

  it("opens the status dialog on s", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key: "s" });

    expect(await screen.findByText("Set Status")).toBeInTheDocument();
  });

  it("opens project workflow settings on e", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key: "e" });

    expect(await screen.findByRole("tab", { name: "States" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("dialog", { name: "Studio settings" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);
  });

  it("opens one accessible Settings modal from the footer without changing workspace state", async () => {
    render(
      <>
        <ModalHost />
        <StudioFooter />
      </>,
    );
    const selection = {
      project: useTasksStore.getState().selectedProjectId,
      module: useTasksStore.getState().selectedModuleId,
      task: useTasksStore.getState().selectedTaskId,
    };
    const tabs = useWorkspaceTabsStore.getState().byTaskId;
    const sessions = useTerminalStore.getState().sessions;
    const opener = screen.getByRole("button", { name: "Open Settings" });
    opener.focus();

    fireEvent.click(opener);
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));

    const dialogButtons = within(dialog).getAllByRole("button");
    const lastControl = dialogButtons.at(-1)!;
    lastControl.focus();
    fireEvent.keyDown(lastControl, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastControl);

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(useTasksStore.getState().selectedProjectId).toBe(selection.project);
    expect(useTasksStore.getState().selectedModuleId).toBe(selection.module);
    expect(useTasksStore.getState().selectedTaskId).toBe(selection.task);
    expect(useWorkspaceTabsStore.getState().byTaskId).toBe(tabs);
    expect(useTerminalStore.getState().sessions).toBe(sessions);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(dialog).not.toBeInTheDocument();
  });

  it("compacts the footer to Keyboard Shortcuts and Settings controls", () => {
    render(<StudioFooter />);

    expect(
      screen.getByRole("button", { name: "Open Keyboard Shortcuts" }),
    ).toHaveTextContent(/\?\s*— Keyboard Shortcuts/);
    expect(
      screen.getByRole("button", { name: "Open Settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("— Next Terminal")).not.toBeInTheDocument();
    expect(screen.queryByText("— Open Agent")).not.toBeInTheDocument();
  });

  it("names the sidebar key and flips its verb with the sidebar", () => {
    useClientStore.setState({ sidebarVisible: true });
    render(<StudioFooter />);

    expect(screen.getByText("— Close Menu").parentElement).toHaveTextContent(
      "\\— Close Menu",
    );

    act(() => useClientStore.getState().setSidebarVisible(false));

    expect(screen.getByText("— Open Menu").parentElement).toHaveTextContent(
      "\\— Open Menu",
    );
    expect(screen.queryByText("— Close Menu")).not.toBeInTheDocument();
  });

  it("omits every sidebar-toggle affordance when the installation disables it", async () => {
    const reboundSidebarToggle = {
      context: "global" as const,
      actionId: "toggle-sidebar",
      chord: {
        key: "x",
        alt: false,
        control: false,
        meta: false,
        shift: false,
      },
    };
    studioKeymapRegistry.setOverrides([reboundSidebarToggle]);
    seedStudioConfig({
      features: { sidebar: false, projects: false },
    });
    useClientStore.setState({ sidebarVisible: true });

    render(
      <>
        <KeymapHarness />
        <ModalHost />
        <StudioFooter />
      </>,
    );

    expect(screen.queryByText(/— (Open|Close) Menu/)).not.toBeInTheDocument();
    expect(
      studioKeymapRegistry.getEffectiveBinding("global", "toggle-sidebar"),
    ).toBeNull();
    expect(
      studioKeymapRegistry
        .getConfigurableBindings()
        .some((binding) => binding.actionId === "toggle-sidebar"),
    ).toBe(false);

    const defaultKeyWasNotConsumed = fireEvent.keyDown(window, { key: "\\" });
    const reboundKeyWasNotConsumed = fireEvent.keyDown(window, { key: "x" });

    expect(defaultKeyWasNotConsumed).toBe(true);
    expect(reboundKeyWasNotConsumed).toBe(true);
    expect(useClientStore.getState().sidebarVisible).toBe(true);
    expect(studioKeymapRegistry.getOverrides()).toEqual([
      reboundSidebarToggle,
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Keyboard Shortcuts" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard Shortcuts",
    });
    expect(within(dialog).queryByText("Toggle sidebar")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("cell", { name: "X" })).not.toBeInTheDocument();
  });

  it("teaches the current edit-view zone and replaces it with disengage while engaged", () => {
    useClientStore.setState({
      sidebarVisible: false,
      editViewZone: "stories",
      editViewBodyEngaged: false,
    });
    render(<StudioFooter />);

    expect(screen.getByText("— Next Zone")).toBeInTheDocument();
    expect(screen.getByText("— Story").parentElement).toHaveTextContent("↑↓— Story");
    expect(screen.getByText("— Workspace").parentElement).toHaveTextContent(
      "→— Workspace",
    );
    expect(screen.getByText("— Dive")).toBeInTheDocument();
    expect(screen.queryByText("— Disengage")).not.toBeInTheDocument();

    act(() => useClientStore.getState().setEditViewZone("tab-strip"));

    expect(screen.getByText("— Next Zone")).toBeInTheDocument();
    expect(screen.getByText("— Tab").parentElement).toHaveTextContent("←→— Tab");
    expect(screen.getByText("— Body").parentElement).toHaveTextContent("↓— Body");
    expect(screen.getByText("— Open")).toBeInTheDocument();
    expect(screen.queryByText("— Story")).not.toBeInTheDocument();

    act(() => useClientStore.getState().setEditViewZone("active-tab-body"));

    expect(screen.getByText("— Next Zone")).toBeInTheDocument();
    expect(screen.getByText("— Tabs").parentElement).toHaveTextContent("↑— Tabs");
    expect(screen.getByText("— Stories").parentElement).toHaveTextContent(
      "←— Stories",
    );
    expect(screen.getByText("— Engage")).toBeInTheDocument();

    act(() => useClientStore.getState().setEditViewBodyEngaged(true));

    expect(screen.getByText("— Disengage").parentElement).toHaveTextContent(
      "⌘Esc— Disengage",
    );
    expect(screen.queryByText("— Next Zone")).not.toBeInTheDocument();
    expect(screen.queryByText("— Engage")).not.toBeInTheDocument();
  });

  it("opens one searchable Keyboard Shortcuts modal from the footer and returns focus", async () => {
    studioKeymapRegistry.setOverrides([
      {
        context: "global",
        actionId: "settings",
        chord: {
          key: "k",
          alt: false,
          control: true,
          meta: false,
          shift: false,
        },
      },
    ]);
    render(
      <>
        <ModalHost />
        <StudioFooter />
      </>,
    );
    const opener = screen.getByRole("button", {
      name: "Open Keyboard Shortcuts",
    });
    opener.focus();

    fireEvent.click(opener);
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard Shortcuts",
    });
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "keyboard-shortcuts" },
    ]);
    const filter = within(dialog).getByRole("searchbox", {
      name: "Filter keyboard shortcuts",
    });
    expect(filter).toHaveFocus();
    expect(within(dialog).getByRole("cell", { name: "Ctrl+K" })).toBeInTheDocument();
    expect(within(dialog).getByText("Next edit-view zone")).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("cell", { name: "Capture" }).length,
    ).toBeGreaterThan(0);
    // Registry bindings + the fixed body-disengage chord + the header row.
    expect(within(dialog).getAllByRole("row")).toHaveLength(
      studioKeymapRegistry.getEffectiveBindings().length + 2,
    );
    expect(
      within(dialog).getByRole("cell", { name: "Disengage body" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("cell", { name: "Cmd+Esc" })).toBeInTheDocument();
    for (const action of [
      "Move up in edit view",
      "Move down in edit view",
      "Move left in edit view",
      "Move right in edit view",
    ]) {
      expect(within(dialog).getByRole("cell", { name: action })).toBeInTheDocument();
    }

    const essentials = within(dialog).getByRole("list");
    expect(within(essentials).getByText("Launch agent").parentElement).toHaveTextContent(
      /Launch agentO$/,
    );
    expect(
      within(essentials).getByText("Disengage body").parentElement,
    ).toHaveTextContent(/Disengage bodyCmd\+Esc$/);
    expect(within(essentials).getByText("Engage body")).toBeInTheDocument();
    expect(within(dialog).queryByText("Restore defaults")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Reset")).not.toBeInTheDocument();

    fireEvent.keyDown(filter, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(filter).toHaveFocus();

    fireEvent.change(filter, { target: { value: "focused pane" } });
    expect(within(dialog).getByText("Next project")).toBeInTheDocument();
    expect(within(dialog).queryByText("Settings")).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "no such action" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "No keyboard shortcuts match",
    );

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("opens Keyboard Shortcuts on ? without intercepting typing targets or open modals", async () => {
    render(
      <>
        <KeymapHarness />
        <ModalHost />
        <input aria-label="Plain input" />
        <div role="textbox" aria-label="Rich editor" contentEditable />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Plain input" });
    fireEvent.keyDown(input, { key: "?", shiftKey: true });
    const editor = screen.getByRole("textbox", { name: "Rich editor" });
    Object.defineProperty(editor, "isContentEditable", { value: true });
    fireEvent.keyDown(editor, { key: "?", shiftKey: true });
    expect(useModalStore.getState().modalStack).toEqual([]);

    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Keyboard Shortcuts" }),
    ).toBeInTheDocument();
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "keyboard-shortcuts" },
    ]);

    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(useModalStore.getState().modalStack).toHaveLength(1);
  });

  it("closes workflow settings on Escape", async () => {
    renderKeymapWithModal();
    useModalStore.getState().openSettings();

    await screen.findByRole("tab", { name: "States" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens the selected module folder dialog on f", async () => {
    renderKeymapWithModal();

    fireEvent.keyDown(window, { key: "f" });

    expect(await screen.findByText("Module Folder")).toBeInTheDocument();
    expect(useModalStore.getState().modalStack.at(-1)?.payload).toEqual({
      moduleId: "module-1",
    });
  });

  it("has no packaged open-web action or w binding", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "w" });

    expect(open).not.toHaveBeenCalled();
    expect(
      studioKeymapRegistry
        .getEffectiveBindings()
        .some((binding) => binding.actionId === "open-web"),
    ).toBe(false);
    expect(useClientStore.getState().bindingsStack.at(-1)).not.toContainEqual({
      key: "w",
      label: "Open Web",
    });
  });

  it("toggles the sidebar with its default or user-rebound key", () => {
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "\\" });

    expect(useClientStore.getState().sidebarVisible).toBe(false);

    act(() => {
      studioKeymapRegistry.setOverrides([
        {
          context: "global",
          actionId: "toggle-sidebar",
          chord: {
            key: "x",
            alt: false,
            control: false,
            meta: false,
            shift: false,
          },
        },
      ]);
    });

    fireEvent.keyDown(window, { key: "\\" });
    expect(useClientStore.getState().sidebarVisible).toBe(false);

    fireEvent.keyDown(window, { key: "x" });
    expect(useClientStore.getState().sidebarVisible).toBe(true);
  });

  it("moves focus left and right with h and l", () => {
    const { unmount } = render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "h" });
    expect(useClientStore.getState().focusedPane).toBe("modules");
    fireEvent.keyDown(window, { key: "h" });
    expect(useClientStore.getState().focusedPane).toBe("projects");

    unmount();
    useClientStore.setState({ focusedPane: "tasks" });
    render(<KeymapHarness />);
    fireEvent.keyDown(window, { key: "l" });
    expect(useClientStore.getState().focusedPane).toBe("details-or-terminal");
  });

  it("cannot traverse left from Modules into Projects when the flag is off", () => {
    seedStudioConfig({
      features: { sidebar: true, projects: false },
    });
    useClientStore.setState({ focusedPane: "modules" });
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "h" });

    expect(useClientStore.getState().focusedPane).toBe("modules");
  });

  it("keeps sidebar panes out of traversal when installation disables them", () => {
    seedStudioConfig({
      features: { sidebar: false, projects: false },
    });
    useClientStore.setState({
      sidebarVisible: true,
      focusedPane: "details-or-terminal",
      editViewZone: "active-tab-body",
    });
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(useClientStore.getState()).toMatchObject({
      sidebarVisible: true,
      focusedPane: "tasks",
      editViewZone: "stories",
    });

    fireEvent.keyDown(window, { key: "h" });

    expect(useClientStore.getState()).toMatchObject({
      sidebarVisible: true,
      focusedPane: "tasks",
    });
  });

  it("closes the active terminal tab on q", () => {
    const sessionId = useTerminalStore.getState().openSession({
      taskId: "task-1",
      projectId: "project-1",
      moduleId: "module-1",
      agent: "codex",
      ticketSeq: 42,
    });
    useTicketWorkspaceStore.getState().setActive("task-1", "terminal");
    render(<KeymapHarness />);

    fireEvent.keyDown(window, { key: "q" });

    expect(useTerminalStore.getState().sessions[sessionId]).toBeUndefined();
    expect(useWorkspaceTabsStore.getState().activeByTask["task-1"]).toBeUndefined();
  });

  it.each([
    ["1", "module-1"],
    ["2", "module-2"],
    ["3", "module-3"],
    ["4", "module-4"],
    ["5", "module-5"],
    ["6", "module-6"],
    ["7", "module-7"],
    ["8", "module-8"],
    ["9", "module-9"],
    ["0", "module-10"],
  ])("maps Cmd+%s to %s", (key, moduleId) => {
    initializeDesktopTestRuntime();
    useTasksStore.setState({
      modules,
      selectedModuleId: "current-module",
    });
    const selectModule = vi
      .spyOn(useTasksStore.getState(), "selectModule")
      .mockResolvedValue();
    render(<KeymapHarness />);

    const notCancelled = fireEvent.keyDown(window, { key, metaKey: true });

    expect(selectModule).toHaveBeenCalledOnce();
    expect(selectModule).toHaveBeenCalledWith(moduleId);
    expect(notCancelled).toBe(false);
  });

  it("does not consume a missing or already-selected desktop module position", () => {
    initializeDesktopTestRuntime();
    useTasksStore.setState({
      modules: modules.slice(0, 2),
      selectedModuleId: "module-2",
    });
    const selectModule = vi
      .spyOn(useTasksStore.getState(), "selectModule")
      .mockResolvedValue();
    render(<KeymapHarness />);

    expect(
      fireEvent.keyDown(window, { key: "2", metaKey: true }),
    ).toBe(true);
    expect(
      fireEvent.keyDown(window, { key: "9", metaKey: true }),
    ).toBe(true);
    expect(selectModule).not.toHaveBeenCalled();
  });

  it("leaves desktop module switching behind modal keyboard ownership", () => {
    initializeDesktopTestRuntime();
    useTasksStore.setState({
      modules,
      selectedModuleId: "module-1",
    });
    useModalStore.setState({
      modalStack: [{ type: "agent-picker", payload: { mode: "open" } }],
    });
    const selectModule = vi
      .spyOn(useTasksStore.getState(), "selectModule")
      .mockResolvedValue();
    render(<KeymapHarness />);

    expect(
      fireEvent.keyDown(window, { key: "2", metaKey: true }),
    ).toBe(true);
    expect(selectModule).not.toHaveBeenCalled();
  });

  it("handles desktop module switching from editable and terminal focus", () => {
    initializeDesktopTestRuntime();
    useTasksStore.setState({
      modules,
      selectedModuleId: "current-module",
    });
    const selectModule = vi
      .spyOn(useTasksStore.getState(), "selectModule")
      .mockResolvedValue();
    render(
      <>
        <KeymapHarness />
        <textarea aria-label="Task notes" />
        <div className="xterm" tabIndex={0} />
      </>,
    );

    expect(
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Task notes" }), {
        key: "2",
        metaKey: true,
      }),
    ).toBe(false);
    expect(
      fireEvent.keyDown(document.querySelector(".xterm")!, {
        key: "3",
        metaKey: true,
      }),
    ).toBe(false);
    expect(selectModule.mock.calls).toEqual([["module-2"], ["module-3"]]);
  });

  it("does not expose, handle, or consume module position bindings in browser Studio", () => {
    useTasksStore.setState({
      modules,
      selectedModuleId: "current-module",
    });
    const selectModule = vi
      .spyOn(useTasksStore.getState(), "selectModule")
      .mockResolvedValue();
    render(
      <>
        <KeymapHarness />
        <input aria-label="Browser input" />
      </>,
    );

    expect(
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Browser input" }), {
        key: "2",
        metaKey: true,
      }),
    ).toBe(true);
    expect(selectModule).not.toHaveBeenCalled();
    expect(
      studioKeymapRegistry
        .getEffectiveBindings()
        .some((binding) =>
          binding.actionId.startsWith("modules.select-position-"),
        ),
    ).toBe(false);
  });
});
