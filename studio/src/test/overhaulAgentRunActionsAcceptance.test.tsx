import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { seedModuleOpenFixture } from "./projectOpenFixture";
import { workItem } from "./seam";
import { setStatesSorted } from "../features/projects";

import {
  AGENT_RUN_ACTIONS,
  studioKeymapRegistry,
} from "../app/navigation/keymapRegistry";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalStore } from "../features/agents/terminal/appNavigation";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { useStudioStore } from "../features/projects";
import {
  createBrowserRuntime,
  initializeStudioRuntime,
  type LaunchkeyRuntime,
} from "../runtime";
import { useClientStore } from "../state/clientStore";

const launchkey: LaunchkeyRuntime = {
  midi: () => null,
  toggleHandyTranscription: vi.fn(async () => {}),
  submitTerminal: vi.fn(async () => {}),
};
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

describe("overhaul acceptance - agent run actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeStudioRuntime({
      ...createBrowserRuntime({ environment: {} }),
      launchkey,
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectedTaskId: null,
      workspaceSelection: { kind: "task" },
      workspaces: {},
      activeByTask: {},
      focusedPane: "tasks",
      sidebarVisible: true,
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "run-1": {
          agent_run_id: "run-1",
          project_id: "project-1",
          task_id: "task-1",
          module_id: "module-1",
          agent: "codex",
          scope: "task",
          state: "working",
          updated_at: "2026-09-04T10:00:00Z",
        },
      },
      automationAttempts: {},
      automationByTask: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("[overhaul-254] dispatches focus through workspace and terminal focus authorities", async () => {
    seedModuleOpenFixture("module-1", [
      workItem({ id: "parent", name: "Parent", state: "ideas", sub_issues_count: 1 }),
      workItem({ id: "middle", name: "Middle", state: "ideas", parent_id: "parent", sub_issues_count: 1 }),
      workItem({ id: "task-1", name: "Pad target", state: "working", parent_id: "middle" }),
    ]);
    setStatesSorted("project-1", [{
      id: "ideas", name: "Ideas", group: "backlog", color: "", sort_order: 0,
      is_protected: false,
    }]);
    useClientStore.setState({
      expandedIdsByModule: {}, collapsedStateIds: new Set(["ideas"]),
      storySearchQuery: "hides the target",
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const pane = render(<TasksPane />);
    expect(screen.queryByText("Pad target")).not.toBeInTheDocument();
    const terminal = document.createElement("button");
    document.body.appendChild(terminal);

    useTerminalStore.setState({
      sessions: {
        "viewer-1": {
          sessionId: "viewer-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
        },
      },
      sessionByRun: { "run-1": "viewer-1" },
    });
    const unregisterFocus = registerTerminalFocus(
      "viewer-1",
      () => terminal.focus(),
    );

    await act(async () => {
      await expect(studioKeymapRegistry.dispatch(
        AGENT_RUN_ACTIONS.focusAgentRun,
        { runId: "run-1" },
      )).resolves.toBe(true);
    });
    act(() => frames.splice(0).forEach((callback) => callback(0)));

    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getByText("Middle")).toBeInTheDocument();
    const selectedRow = screen.getByText("Pad target").closest('[role="treeitem"]');
    expect(selectedRow).toHaveAttribute("aria-selected", "true");
    expect(scroll.mock.contexts).toContain(selectedRow);
    expect(useClientStore.getState().collapsedStateIds.has("ideas")).toBe(false);
    expect(useClientStore.getState().expandedIdsByModule["module-1"]).toEqual(
      expect.arrayContaining(["parent", "middle"]),
    );

    scroll.mockClear();
    await act(async () => {
      await studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId: "run-1" });
    });
    act(() => frames.splice(0).forEach((callback) => callback(0)));
    expect(scroll.mock.contexts).toContain(selectedRow);

    expect(document.activeElement).toBe(terminal);

    unregisterFocus();
    terminal.remove();
    pane.unmount();
  });

  it("dispatches voice toggle through the runtime contract", async () => {
    await expect(studioKeymapRegistry.dispatch(
      AGENT_RUN_ACTIONS.toggleVoiceTranscription,
    )).resolves.toBe(true);

    expect(launchkey.toggleHandyTranscription).toHaveBeenCalledOnce();
  });

  it("submits only the selected run terminal and never the focused form", async () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    form.appendChild(input);
    form.addEventListener("submit", onSubmit);
    document.body.appendChild(form);
    input.focus();

    useClientStore.setState({
      selectedTaskId: "task-1",
      workspaces: {
        "task-1": {
          active: "terminal",
          activeDocId: null,
          closedDocIds: [],
        },
      },
      activeByTask: { "task-1": "viewer-1" },
    });
    useTerminalStore.setState({
      sessions: {
        "viewer-1": {
          sessionId: "viewer-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-1",
        },
      },
      sessionByRun: { "run-1": "viewer-1" },
    });

    await expect(studioKeymapRegistry.dispatch(
      AGENT_RUN_ACTIONS.submitSelectedRunTerminal,
    )).resolves.toBe(true);

    expect(launchkey.submitTerminal).toHaveBeenCalledWith("viewer-1");
    expect(onSubmit).not.toHaveBeenCalled();

    vi.mocked(launchkey.submitTerminal).mockClear();
    useClientStore.setState({ selectedTaskId: null });
    await expect(studioKeymapRegistry.dispatch(
      AGENT_RUN_ACTIONS.submitSelectedRunTerminal,
    )).resolves.toBe(false);
    expect(launchkey.submitTerminal).not.toHaveBeenCalled();

    form.remove();
  });
});
