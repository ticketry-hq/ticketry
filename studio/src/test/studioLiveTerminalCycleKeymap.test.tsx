import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "../app/modal";
import { useAgentStatusStore } from "../features/agents/status";
import {
  useTerminalForegroundStore,
  useTerminalStore,
  useWorkspaceTabsStore,
  type SessionMeta,
} from "../features/agents/terminal";
import { WorkspaceTerminalHost } from "../features/agents/terminal/WorkspaceTerminalHost";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import type { TaskSummary } from "../features/studio/lib/types";
import type { Row } from "../features/studio/pages/tasks/TasksPane";
import { seedConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { useIssueDrawerWorkspaceStore } from "../features/work-items/issue-detail";

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    private input: HTMLTextAreaElement | null = null;

    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this);
    }

    attachCustomKeyEventHandler() {}

    open(host: HTMLElement) {
      this.input = document.createElement("textarea");
      this.input.className = "xterm-helper-textarea";
      this.input.setAttribute("aria-label", "Terminal input");
      host.replaceChildren(this.input);
    }

    focus() {
      this.input?.focus();
    }

    onData() {
      return { dispose() {} };
    }

    write() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
    fit() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("../features/agents/terminal/internal/terminalClientRuntime", () => ({
  terminalClientTransport: {
    attach: () => ({
      input: vi.fn(),
      resize: vi.fn(),
      scroll: vi.fn(),
      detach: vi.fn(),
      suspend: () => false,
      resume: vi.fn(),
      status: () => "ready",
    }),
  },
}));

function task(id: string, sequenceId: number): TaskSummary {
  return {
    id,
    name: id,
    project_id: "project-1",
    sequence_id: sequenceId,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state: { id: "state-1", name: "Todo", group: "backlog", color: null },
    description: null,
    parent_id: null,
    sub_issues_count: 0,
  };
}

function taskRow(summary: TaskSummary): Row {
  return {
    task: summary,
    depth: 0,
    parentId: null,
    hasChildren: false,
    isExpanded: false,
    isLoading: false,
    descendantIds: [],
  };
}

function session(
  sessionId: string,
  agentRunId: string,
  taskId: string,
  ticketSeq: number,
): SessionMeta {
  return {
    sessionId,
    agentRunId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    ticketSeq,
    status: "ready",
    transport: "ready",
    backendSession: "alive",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    isDocChat: false,
    docRelPath: null,
    docId: null,
  };
}

const firstTask = task("task-1", 1);
const secondTask = task("task-2", 2);
const rows = [taskRow(firstTask), taskRow(secondTask)];

function Harness() {
  useGlobalKeymap(rows);
  const selectedTaskId = useTasksStore((state) => state.selectedTaskId);
  return <WorkspaceTerminalHost bucket={selectedTaskId} />;
}

function pressCycle(
  target: EventTarget,
  direction: "forward" | "backward",
): KeyboardEvent {
  const backward = direction === "backward";
  const event = new KeyboardEvent("keydown", {
    key: backward ? "|" : "\\",
    code: backward ? "Backslash" : "",
    metaKey: true,
    shiftKey: backward,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("Studio live-terminal cycle keymap", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    useModalStore.setState({ modalStack: [], activeBindings: null });
    seedConfig({
      features: { sidebar: true, projects: true },
    });
    useTasksStore.setState({
      selectedProjectId: "project-1",
      selectedModuleId: "module-1",
      selectedTaskId: "task-1",
      tasks: [firstTask, secondTask],
      states: [firstTask.state],
    });
    useUIStore.setState({
      sidebarVisible: true,
      editViewZone: "stories",
      focusedPane: "details-or-terminal",
      modalStack: [],
    });
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: {
        "run-1": {
          runId: "run-1",
          taskId: "task-1",
          moduleId: "module-1",
          scope: "task",
          state: "working",
          updatedAt: "2026-07-17T12:00:00Z",
        },
        "run-2": {
          runId: "run-2",
          taskId: "task-2",
          moduleId: "module-1",
          scope: "task",
          state: "needs_input",
          updatedAt: "2026-07-17T12:00:00Z",
        },
        "run-2b": {
          runId: "run-2b",
          taskId: "task-2",
          moduleId: "module-1",
          scope: "task",
          state: "quiet",
          updatedAt: "2026-07-17T12:00:00Z",
        },
      },
      byTask: {
        "task-1": ["run-1"],
        "task-2": ["run-2", "run-2b"],
      },
      automationAttempts: {},
      automationByTask: {},
    });
    useTerminalStore.setState({
      sessions: {
        "session-1": session("session-1", "run-1", "task-1", 1),
        "session-2": session("session-2", "run-2", "task-2", 2),
        "session-2b": session("session-2b", "run-2b", "task-2", 2),
      },
      sessionByRun: {
        "run-1": "session-1",
        "run-2": "session-2",
        "run-2b": "session-2b",
      },
      persistedSessions: {},
      resumableSessions: {},
    });
    useWorkspaceTabsStore.setState({
      byTaskId: {
        "task-1": ["session-1"],
        "task-2": ["session-2", "session-2b"],
      },
      activeByTask: { "task-1": "session-1", "task-2": "session-2b" },
      chatByDoc: {},
      focusRequest: null,
    });
    useIssueDrawerWorkspaceStore.setState({
      workspaces: {
        "task-1": {
          active: "terminal",
          activeDocId: null,
          docs: [],
          history: [],
          overlayOpenByDoc: {},
        },
        "task-2": {
          active: "details",
          activeDocId: null,
          docs: [],
          history: [],
          overlayOpenByDoc: {},
        },
      },
    });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  });

  it("leaves Command-backslash inactive in the edit view", () => {
    useUIStore.setState({
      sidebarVisible: false,
      editViewZone: "stories",
      focusedPane: "tasks",
    });
    render(<Harness />);

    const event = pressCycle(window, "forward");

    expect(event.defaultPrevented).toBe(false);
    expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
    expect(useWorkspaceTabsStore.getState().activeByTask["task-1"]).toBe(
      "session-1",
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures Cmd+\\ from the terminal, lands focused, and wraps", async () => {
    render(<Harness />);
    const firstInput = document.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    )!;
    firstInput.focus();
    const ptyKeydown = vi.fn();
    firstInput.addEventListener("keydown", ptyKeydown);

    let event!: KeyboardEvent;
    act(() => {
      event = pressCycle(firstInput, "forward");
    });

    expect(event.defaultPrevented).toBe(true);
    expect(ptyKeydown).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2",
      );
      expect(
        useIssueDrawerWorkspaceStore.getState().workspaces["task-2"].active,
      ).toBe("terminal");
      expect(document.activeElement).toBe(
        document.querySelector(".xterm-helper-textarea"),
      );
    });

    act(() => {
      pressCycle(document.activeElement as HTMLElement, "forward");
    });

    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2b",
      );
      expect(document.activeElement).toBe(
        document.querySelector(".xterm-helper-textarea"),
      );
    });

    act(() => {
      pressCycle(document.activeElement as HTMLElement, "forward");
    });

    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
      expect(document.activeElement).toBe(
        document.querySelector(".xterm-helper-textarea"),
      );
    });
  });

  it("captures Cmd+Shift+\\ from the terminal, traverses backward, and wraps", async () => {
    render(<Harness />);
    const firstInput = document.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    )!;
    firstInput.focus();
    const ptyKeydown = vi.fn();
    firstInput.addEventListener("keydown", ptyKeydown);

    let event!: KeyboardEvent;
    act(() => {
      event = pressCycle(firstInput, "backward");
    });

    expect(event.defaultPrevented).toBe(true);
    expect(ptyKeydown).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2b",
      );
      expect(
        useIssueDrawerWorkspaceStore.getState().workspaces["task-2"].active,
      ).toBe("terminal");
      expect(document.activeElement).toBe(
        document.querySelector(".xterm-helper-textarea"),
      );
    });

    act(() => {
      pressCycle(document.activeElement as HTMLElement, "backward");
    });

    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2",
      );
    });

    act(() => {
      pressCycle(document.activeElement as HTMLElement, "forward");
    });

    await waitFor(() => {
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2b",
      );
    });
  });

  it("returns to the starting terminal after cycling forward then backward", async () => {
    render(<Harness />);

    act(() => {
      pressCycle(window, "forward");
    });
    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
        "session-2",
      );
    });

    act(() => {
      pressCycle(window, "backward");
    });
    await waitFor(() => {
      expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
      expect(useWorkspaceTabsStore.getState().activeByTask["task-1"]).toBe(
        "session-1",
      );
    });
  });

  it("intercepts the chord without moving when the module has no live terminals", () => {
    useAgentStatusStore.setState((state) => ({
      runs: {
        ...state.runs,
        "run-1": { ...state.runs["run-1"], state: "exited" },
        "run-2": { ...state.runs["run-2"], state: "lost" },
        "run-2b": { ...state.runs["run-2b"], state: "lost" },
      },
    }));
    render(<Harness />);
    const input = document.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    )!;
    input.focus();
    const ptyKeydown = vi.fn();
    input.addEventListener("keydown", ptyKeydown);

    let event!: KeyboardEvent;
    act(() => {
      event = pressCycle(input, "forward");
    });

    expect(event.defaultPrevented).toBe(true);
    expect(ptyKeydown).not.toHaveBeenCalled();
    expect(useTasksStore.getState().selectedTaskId).toBe("task-1");
    expect(useWorkspaceTabsStore.getState().activeByTask).toEqual({
      "task-1": "session-1",
      "task-2": "session-2b",
    });
    expect(
      useIssueDrawerWorkspaceStore.getState().workspaces["task-1"].active,
    ).toBe("terminal");
    expect(document.activeElement).toBe(input);
  });

  it("advances from the selected work item's terminal while Details is foregrounded", () => {
    useIssueDrawerWorkspaceStore.getState().setActive("task-1", "details");
    render(<Harness />);

    act(() => {
      pressCycle(window, "forward");
    });

    expect(useTasksStore.getState().selectedTaskId).toBe("task-2");
    expect(useWorkspaceTabsStore.getState().activeByTask["task-2"]).toBe(
      "session-2",
    );
  });
});
