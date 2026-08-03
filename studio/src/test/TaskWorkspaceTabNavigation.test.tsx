import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../features/agents/api/agentApi", async () => {
  const actual = await vi.importActual<typeof import("../features/agents/api/agentApi")>(
    "../features/agents/api/agentApi",
  );
  return {
    ...actual,
    getDocuments: vi.fn(() => new Promise(() => {})),
    getScratchDocuments: vi.fn(() => new Promise(() => {})),
    getTerminals: vi.fn(() => new Promise(() => {})),
    getScratchTerminals: vi.fn(() => new Promise(() => {})),
    listResumableTerminals: vi.fn(() => new Promise(() => {})),
    resumeTerminal: vi.fn(),
    terminateTerminal: vi.fn(),
  };
});

const terminalHarness = vi.hoisted(() => ({
  nextTerminal: 0,
  focusOrder: [] as number[],
  socketOpen: vi.fn(),
  socketClose: vi.fn(),
  transportResume: vi.fn(),
}));

vi.mock("xterm", () => ({
  Terminal: class {
    readonly index = terminalHarness.nextTerminal++;
    readonly textarea = document.createElement("textarea");
    cols = 80;
    rows = 24;

    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this);
    }
    attachCustomKeyEventHandler() {}
    open(host: HTMLElement) {
      const root = document.createElement("div");
      root.className = "xterm";
      this.textarea.className = "xterm-helper-textarea";
      root.appendChild(this.textarea);
      host.appendChild(root);
    }
    focus() {
      terminalHarness.focusOrder.push(this.index);
      this.textarea.focus();
    }
    onData() {
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    write() {}
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
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
    attach: () => {
      terminalHarness.socketOpen();
      return {
        input: vi.fn(),
        resize: vi.fn(),
        scroll: vi.fn(),
        detach: terminalHarness.socketClose,
        suspend: () => false,
        resume: terminalHarness.transportResume,
        status: () => "ready",
      };
    },
  },
}));

import * as agentApi from "../features/agents/api/agentApi";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import {
  DEFAULT_WORKSPACE,
  useTicketWorkspaceStore,
} from "../app/shell/ticket-workspace/selected-ticket";
import {
  scratchBucketId,
  useTerminalStore,
  useWorkspaceTabsStore,
  type SessionMeta,
} from "../features/agents/terminal";
import {
  SCRATCH_RUN_TASK_ID,
  type DocTabState,
  type PersistedTerminalSession,
} from "../features/agents/types";
import { PaneShell } from "../app/shell/PaneShell";
import { useModalStore } from "../app/modal";
import { ModalShell } from "../app/modal/ModalShell";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { MODAL_ACTIONS } from "../app/navigation/keymapRegistry";
import type { TaskSummary } from "../features/studio/lib/types";
import type { Row } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { seedConfig } from "../features/studio/stores/configStore";
import { useTasksStore } from "../features/studio/stores/tasksStore";
import { useUIStore } from "../features/studio/stores/uiStore";
import { setProviderCapabilities } from "../features/workflows/providerQueries";
import { dispatchStatusFrame } from "../features/agents/status/statusFeed";
import { useAgentStatusStore } from "../features/agents/status";

const TASK_ID = "task-1";
const NEXT_TASK_ID = "task-2";

const taskSummaries: TaskSummary[] = [TASK_ID, NEXT_TASK_ID].map(
  (id, index) => ({
    id,
    name: `Task ${index + 1}`,
    project_id: "project-1",
    sequence_id: index + 3,
    key: `MEML-${index + 3}`,
    issue_type: { id: "type-story", name: "Story", level: "task" },
    state: { id: "state-1", name: "Todo", group: "backlog", color: null },
    description: null,
    parent_id: null,
    sub_issues_count: 0,
  }),
);

const taskRows: Row[] = taskSummaries.map((task) => ({
  task,
  depth: 0,
  parentId: null,
  hasChildren: false,
  isExpanded: false,
  isLoading: false,
  descendantIds: [],
}));

function TaskKeymapHarness({ rows = taskRows }: { rows?: Row[] }) {
  useGlobalKeymap(rows);
  return null;
}

function ModalKeymapHarness({ onClose }: { onClose: () => void }) {
  const [cursor, setCursor] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <ModalShell
      title="Keymap regression modal"
      onClose={onClose}
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Choose" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.next) setCursor((value) => value + 1);
        if (actionId === MODAL_ACTIONS.previous) setCursor((value) => value - 1);
        if (actionId === MODAL_ACTIONS.confirm) setConfirmed(true);
      }}
    >
      <input aria-label="Modal control" />
      <output aria-label="Modal cursor">{cursor}</output>
      <output aria-label="Modal confirmed">{String(confirmed)}</output>
    </ModalShell>
  );
}

function SelectedTaskWorkspace() {
  const selectedTaskId = useTasksStore((state) => state.selectedTaskId);
  const ticketKey = useTasksStore(
    (state) => state.tasks.find((task) => task.id === selectedTaskId)?.key,
  );
  return (
    <SelectedTicketContent
      bucket={selectedTaskId}
      projectId="project-1"
      moduleId="module-1"
      ticketKey={ticketKey}
      owner="studio"
      details={<div>Task details</div>}
    />
  );
}

function doc(
  docId: string,
  label: string,
  open = true,
): DocTabState {
  return {
    docId,
    relPath: `spec/${docId}.html`,
    label,
    open,
    reloadToken: 0,
  };
}

function session(
  sessionId: string,
  agent: SessionMeta["agent"],
): SessionMeta {
  return {
    sessionId,
    taskId: TASK_ID,
    projectId: "project-1",
    moduleId: "module-1",
    agent,
    ticketSeq: 3,
    status: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: `run-${sessionId}`,
    isDocChat: false,
    docRelPath: null,
    docId: null,
  };
}

function seedWorkspace() {
  useTicketWorkspaceStore.setState({
    workspaces: {
      [TASK_ID]: {
        ...DEFAULT_WORKSPACE,
        docs: [
          doc("design", "Design"),
          doc("notes", "Notes"),
          doc("closed", "Closed", false),
        ],
        history: [
          { label: "old run", agent: "claude", agentRunId: "old-run" },
        ],
        overlayOpenByDoc: { design: true },
      },
    },
  });
  useTerminalStore.setState({
    sessions: {
      "session-1": session("session-1", "claude"),
      "session-2": session("session-2", "codex"),
    },
    sessionByRun: {},
    persistedSessions: {},
    resumableSessions: {
      [TASK_ID]: [
        {
          agent_run_id: "dormant-run",
          agent: "gemini",
          status: "exited",
          started_at: "2026-07-01T00:00:00Z",
          ended_at: "2026-07-01T01:00:00Z",
          provider_session_id: "provider-1",
          resumed_from: null,
        },
      ],
    },
  });
  useWorkspaceTabsStore.setState({
    byTaskId: { [TASK_ID]: ["session-1", "session-2"] },
    activeByTask: { [TASK_ID]: "session-1" },
    chatByDoc: {},
  });
}

function mount(
  bucket: string | null = TASK_ID,
  entrySignal = 0,
  owner: "studio" | "drawer" = "drawer",
) {
  return render(
    <>
      <TaskKeymapHarness />
      <SelectedTicketContent
        bucket={bucket}
        projectId="project-1"
        moduleId="module-1"
        ticketKey="MEML-3"
        owner={owner}
        launchContext={{
          kind: "task",
          projectId: "project-1",
          moduleId: "module-1",
          taskId: TASK_ID,
          taskKey: "MEML-3",
          taskName: "Keyboard task",
          ticketSeq: 3,
          profileReady: true,
          profile: { name: "profile" } as never,
        }}
        entrySignal={entrySignal}
        details={<div>Task details</div>}
      />
    </>,
  );
}

function keydown(
  target: Window | Document | Node | Element,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowRight",
    metaKey: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}

function selectedTab(): HTMLElement {
  return screen.getAllByRole("tab").find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  )!;
}

beforeEach(() => {
  // Persisted workspace targets, the live-run set and the dismissed-run set all
  // outlive a single test in jsdom; start every case from an empty browser.
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  terminalHarness.nextTerminal = 0;
  terminalHarness.focusOrder.length = 0;
  terminalHarness.socketOpen.mockClear();
  terminalHarness.socketClose.mockClear();
  terminalHarness.transportResume.mockClear();
  useTicketWorkspaceStore.setState({ workspaces: {} });
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
    focusRequest: null,
    focusSequence: 0,
  });
  seedConfig({
    features: { sidebar: true, projects: true },
  });
  useUIStore.setState({
    focusedPane: "tasks",
    editViewZone: "stories",
    editViewBodyEngaged: false,
    navigationModality: "keyboard",
    sidebarVisible: true,
    modalStack: [],
  });
  useModalStore.setState({ modalStack: [], activeBindings: null });
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    byTask: {},
    automationAttempts: {},
    automationByTask: {},
    workItemCursors: {},
  });
  useTasksStore.setState({
    selectedProjectId: "project-1",
    selectedModuleId: "module-1",
    selectedTaskId: TASK_ID,
    tasks: taskSummaries,
    states: [taskSummaries[0].state],
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  seedWorkspace();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  (document.activeElement as HTMLElement | null)?.blur?.();
});

describe("workspace terminal tab state", () => {
  it("uses the live ticket key for the tab and its close affordance", () => {
    mount();

    expect(screen.getByRole("tab", { name: "MEML-3 · claude" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Close terminal MEML-3 · claude",
      }),
    ).toBeInTheDocument();
  });

  it("falls back from an unresolved key to the sequence and then the agent", () => {
    render(
      <SelectedTicketContent
        bucket={TASK_ID}
        projectId="project-1"
        moduleId="module-1"
        owner="drawer"
        details={<div>Task details</div>}
      />,
    );

    expect(screen.getByRole("tab", { name: "#3 · claude" })).toBeInTheDocument();

    act(() => {
      useTerminalStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          "session-1": {
            ...state.sessions["session-1"],
            ticketSeq: null,
          },
        },
      }));
    });

    expect(screen.getByRole("tab", { name: "claude" })).toBeInTheDocument();
  });

  it("selects an unselected tab opened into an empty bucket", () => {
    useWorkspaceTabsStore
      .getState()
      .tabOpened(NEXT_TASK_ID, "restored-session", false);

    expect(useWorkspaceTabsStore.getState().activeByTask[NEXT_TASK_ID]).toBe(
      "restored-session",
    );
  });

  it("does not steal an existing selection for an unselected tab", () => {
    useWorkspaceTabsStore
      .getState()
      .tabOpened(TASK_ID, "restored-session", false);

    expect(useWorkspaceTabsStore.getState().activeByTask[TASK_ID]).toBe(
      "session-1",
    );
  });

  it("clears a focus request when its tab closes", () => {
    useWorkspaceTabsStore
      .getState()
      .tabFocused(TASK_ID, "session-1");

    useWorkspaceTabsStore.getState().tabClosed("session-1");

    expect(useWorkspaceTabsStore.getState().focusRequest).toBeNull();
  });
});

describe("Studio edit-view navigation zones", () => {
  function mountEditView(
    rows: Row[] = taskRows,
    workspaceBucket: string | null = TASK_ID,
  ) {
    useUIStore.getState().setSidebarVisible(false);
    return render(
      <>
        <TaskKeymapHarness rows={rows} />
        <PaneShell pane="tasks">
          <input aria-label="Capture an idea" data-idea-entry="true" />
          Task list
        </PaneShell>
        <PaneShell pane="details-or-terminal">
          {workspaceBucket === TASK_ID ? (
            <SelectedTaskWorkspace />
          ) : (
            <SelectedTicketContent
              bucket={workspaceBucket}
              projectId="project-1"
              moduleId="module-1"
              owner="studio"
              details={<div>Task details</div>}
            />
          )}
        </PaneShell>
      </>,
    );
  }

  function shiftTab(): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    fireEvent(window, event);
    return event;
  }

  it("opens on Stories and cycles forward through exactly three emphasized zones", () => {
    const view = mountEditView();
    const workspace = view.container.querySelector<HTMLElement>(
      '[data-pane="details-or-terminal"]',
    )!;
    const zones = view.container.querySelectorAll("[data-navigation-zone]");
    const stories = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="stories"]',
    )!;
    const tabStrip = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="tab-strip"]',
    )!;
    const body = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="active-tab-body"]',
    )!;

    expect(zones).toHaveLength(3);
    expect(tabStrip).toHaveClass("min-h-10", "items-center", "px-1", "py-1");
    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(stories).toHaveFocus();
    expect(stories).toHaveClass("ring-1");
    expect(workspace).not.toHaveClass("ring-1");
    expect(tabStrip).toHaveClass("opacity-[0.65]");
    expect(body).toHaveClass("opacity-[0.65]");

    expect(shiftTab().defaultPrevented).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
    expect(tabStrip).toHaveFocus();
    expect(tabStrip).toHaveClass("ring-1");
    expect(workspace).not.toHaveClass("ring-1");
    expect(stories).toHaveClass("opacity-[0.65]");

    expect(shiftTab().defaultPrevented).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(body).toHaveFocus();
    expect(
      body.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).toHaveClass("ring-1");
    expect(workspace).not.toHaveClass("ring-1");
    expect(tabStrip).toHaveClass("opacity-[0.65]");

    expect(shiftTab().defaultPrevented).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(stories).toHaveFocus();
  });

  it("shows zone chrome only after keyboard navigation and routes from the clicked zone", () => {
    const view = mountEditView();
    const stories = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="stories"]',
    )!;
    const tabStrip = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="tab-strip"]',
    )!;
    const body = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="active-tab-body"]',
    )!;

    fireEvent.mouseDown(tabStrip);

    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
    expect(stories).not.toHaveClass("opacity-[0.65]");
    expect(stories).not.toHaveClass("ring-1");
    expect(tabStrip).not.toHaveClass("opacity-[0.65]");
    expect(tabStrip).not.toHaveClass("ring-1");
    expect(body).not.toHaveClass("opacity-[0.65]");
    expect(
      body.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(tabStrip).toHaveClass("ring-1");
    expect(stories).toHaveClass("opacity-[0.65]");
    expect(body).toHaveClass("opacity-[0.65]");

    fireEvent.mouseDown(stories);

    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(stories).not.toHaveClass("opacity-[0.65]");
    expect(stories).not.toHaveClass("ring-1");
    expect(tabStrip).not.toHaveClass("opacity-[0.65]");
    expect(tabStrip).not.toHaveClass("ring-1");
    expect(body).not.toHaveClass("opacity-[0.65]");
    expect(screen.getByRole("tab", { name: "Design" })).toHaveClass(
      "hover:bg-pane-title",
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(useTasksStore.getState().selectedTaskId).toBe(NEXT_TASK_ID);
    expect(stories).toHaveClass("ring-1");
    expect(tabStrip).toHaveClass("opacity-[0.65]");
    expect(body).toHaveClass("opacity-[0.65]");
  });

  it("leaves native Shift+Tab untouched in the full sidebar view", () => {
    useUIStore.getState().setSidebarVisible(true);
    render(<TaskKeymapHarness />);

    expect(shiftTab().defaultPrevented).toBe(false);
    expect(useUIStore.getState().focusedPane).toBe("tasks");
  });

  it("moves and clamps the Stories selection, then focuses idea entry above the first Story", () => {
    mountEditView();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useTasksStore.getState().selectedTaskId).toBe(NEXT_TASK_ID);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useTasksStore.getState().selectedTaskId).toBe(NEXT_TASK_ID);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByRole("textbox", { name: "Capture an idea" })).toHaveFocus();
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
  });

  it.each([
    ["shared", "stories"],
    ["shared", "tab-strip"],
    ["shared", "active-tab-body"],
    ["legacy UI", "stories"],
    ["legacy UI", "tab-strip"],
    ["legacy UI", "active-tab-body"],
  ] as const)(
    "keeps modal key handling ahead of %s-store edit-view %s navigation",
    (store, zone) => {
      const onClose = vi.fn();
      useUIStore.getState().setSidebarVisible(false);
      useUIStore.getState().setEditViewZone(zone);
      if (store === "shared") {
        useModalStore.setState({ modalStack: [{ type: "settings" }] });
      } else {
        useUIStore.setState({ modalStack: [{ type: "settings" }] });
      }
      const view = render(
        <>
          <TaskKeymapHarness
            rows={[
              { ...taskRows[0], hasChildren: true },
              { ...taskRows[1], depth: 1, parentId: TASK_ID },
            ]}
          />
          <PaneShell pane="tasks">
            <input aria-label="Capture an idea" data-idea-entry="true" />
            Task list
          </PaneShell>
          <PaneShell pane="details-or-terminal">
            <SelectedTaskWorkspace />
          </PaneShell>
          <ModalKeymapHarness onClose={onClose} />
        </>,
      );
      const initialWorkspace =
        useTicketWorkspaceStore.getState().workspaces[TASK_ID];
      const initialExpanded = useUIStore.getState().expandedTaskIds;
      const modalControl = screen.getByRole("textbox", {
        name: "Modal control",
      });

      fireEvent.keyDown(modalControl, { key: "ArrowDown" });
      expect(screen.getByRole("status", { name: "Modal cursor" })).toHaveTextContent("1");
      fireEvent.keyDown(modalControl, { key: "ArrowUp" });
      expect(screen.getByRole("status", { name: "Modal cursor" })).toHaveTextContent("0");
      fireEvent.keyDown(modalControl, { key: "ArrowLeft" });
      fireEvent.keyDown(modalControl, { key: "ArrowRight" });
      fireEvent.keyDown(modalControl, { key: "Tab", shiftKey: true });
      fireEvent.keyDown(modalControl, { key: "Enter" });
      expect(
        screen.getByRole("status", { name: "Modal confirmed" }),
      ).toHaveTextContent("true");
      fireEvent.keyDown(modalControl, { key: "Escape" });

      expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
      expect(useUIStore.getState().editViewZone).toBe(zone);
      expect(useUIStore.getState().expandedTaskIds).toEqual(initialExpanded);
      expect(
        useTicketWorkspaceStore.getState().workspaces[TASK_ID],
      ).toEqual(initialWorkspace);
      expect(onClose).toHaveBeenCalledOnce();
      expect(view.container).toBeInTheDocument();
    },
  );

  it("expands a collapsed Story parent, then exits right once it is expanded", () => {
    const collapsedRows: Row[] = [
      { ...taskRows[0], hasChildren: true },
      { ...taskRows[1], depth: 1, parentId: TASK_ID },
    ];
    const view = mountEditView(collapsedRows);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useUIStore.getState().expandedTaskIds.has(TASK_ID)).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("stories");

    const expandedRows: Row[] = [
      { ...collapsedRows[0], isExpanded: true },
      collapsedRows[1],
    ];
    view.rerender(
      <>
        <TaskKeymapHarness rows={expandedRows} />
        <PaneShell pane="tasks">
          <input aria-label="Capture an idea" data-idea-entry="true" />
          Task list
        </PaneShell>
        <PaneShell pane="details-or-terminal">
          <SelectedTaskWorkspace />
        </PaneShell>
      </>,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);

    useUIStore.getState().setEditViewZone("stories");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(useUIStore.getState().expandedTaskIds.has(TASK_ID)).toBe(false);
    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
  });

  it("exits right from a leaf Story into the tab strip", () => {
    mountEditView();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
  });

  it("keeps Stories selected when Right has no selected ticket", () => {
    useTasksStore.setState({ selectedTaskId: null });
    mountEditView(taskRows, null);

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(useTasksStore.getState().selectedTaskId).toBeNull();
  });

  it("keeps Stories selected when the workspace has no navigable tabs", () => {
    mountEditView(taskRows, null);

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
  });

  it("dives from Stories into the active tab body without changing the active tab", async () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "doc",
          activeDocId: "notes",
        },
      },
    }));
    mountEditView();

    fireEvent.keyDown(window, { key: "Enter" });

    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(selectedTab()).toHaveAccessibleName("Notes");
    expect(
      document.querySelector('[data-navigation-zone="active-tab-body"]'),
    ).toHaveFocus();
  });

  it("lands the tab-strip highlight on the selected ticket's remembered active tab", () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "doc",
          activeDocId: "notes",
        },
      },
    }));
    mountEditView();

    shiftTab();

    expect(screen.getByRole("tab", { name: "Notes" })).toHaveAttribute(
      "data-highlighted",
      "true",
    );
  });

  it("shows tab emphasis only while the tab strip owns navigation", () => {
    const view = mountEditView();
    const body = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="active-tab-body"]',
    )!;
    const stories = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="stories"]',
    )!;

    shiftTab();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const design = screen.getByRole("tab", { name: "Design" });
    expect(design).toHaveAttribute("data-highlighted", "true");
    expect(design).toHaveClass("hover:bg-pane-title");

    shiftTab();
    expect(body).toHaveFocus();
    expect(design).not.toHaveAttribute("data-highlighted");
    expect(design).not.toHaveClass("hover:bg-pane-title");

    shiftTab();
    expect(stories).toHaveFocus();
    expect(design).not.toHaveAttribute("data-highlighted");
    expect(design).not.toHaveClass("hover:bg-pane-title");
  });

  it("moves the tab-strip highlight or exits left at its edge, while right still clamps", () => {
    mountEditView();
    shiftTab();

    const details = screen.getByRole("tab", { name: "Details" });
    const design = screen.getByRole("tab", { name: "Design" });
    expect(details).toHaveAttribute("data-highlighted", "true");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(useUIStore.getState().editViewZone).toBe("stories");

    shiftTab();
    expect(details).toHaveAttribute("data-highlighted", "true");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(design).toHaveAttribute("data-highlighted", "true");
    expect(selectedTab()).toHaveAccessibleName("Details");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
    expect(details).toHaveAttribute("data-highlighted", "true");

    for (let index = 0; index < 10; index += 1) {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    }
    expect(screen.getByRole("tab", { name: "MEML-3 · codex" })).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    expect(useUIStore.getState().editViewZone).toBe("tab-strip");

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "MEML-3 · codex" })).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    expect(useUIStore.getState().editViewZone).toBe("tab-strip");
  });

  it.each(["Enter", "ArrowDown"])(
    "%s commits a non-active highlighted tab and enters its body",
    async (key) => {
      mountEditView();
      shiftTab();

      const design = screen.getByRole("tab", { name: "Design" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(design).toHaveAttribute("data-highlighted", "true");
      expect(selectedTab()).toHaveAccessibleName("Details");

      fireEvent.keyDown(window, { key });

      expect(selectedTab()).toHaveAccessibleName("Design");
      expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
      await waitFor(() =>
        expect(
          screen
            .getByTitle("Design")
            .closest<HTMLElement>('[data-navigation-zone="active-tab-body"]'),
        ).toContainElement(document.activeElement as HTMLElement | null),
      );
    },
  );

  it("Down enters the body when the active tab is highlighted", () => {
    mountEditView();
    shiftTab();

    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "data-highlighted",
      "true",
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
  });

  it.each([
    ["ArrowUp", "tab-strip"],
    ["ArrowLeft", "stories"],
    ["ArrowDown", "active-tab-body"],
    ["ArrowRight", "active-tab-body"],
  ] as const)(
    "%s from an un-engaged body follows the body's hard-edged zone geometry",
    (key, expectedZone) => {
      mountEditView();
      shiftTab();
      shiftTab();

      expect(useUIStore.getState().editViewBodyEngaged).toBe(false);

      fireEvent.keyDown(window, { key });

      expect(useUIStore.getState().editViewZone).toBe(expectedZone);
      expect(useUIStore.getState().editViewBodyEngaged).toBe(false);
    },
  );

  it("leaves Command-arrows inactive in the edit view", () => {
    mountEditView();
    shiftTab();
    shiftTab();

    const next = keydown(window);
    const previous = keydown(window, { key: "ArrowLeft" });

    expect(next.defaultPrevented).toBe(false);
    expect(previous.defaultPrevented).toBe(false);
    expect(selectedTab()).toHaveAccessibleName("Details");
  });

  it("enters terminal typing explicitly and leaves every key except Cmd+Escape to xterm", async () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
      },
    }));
    const view = mountEditView();
    const body = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="active-tab-body"]',
    )!;
    const stories = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="stories"]',
    )!;

    shiftTab();
    shiftTab();
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(body).toHaveFocus();
    expect(
      body.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).toHaveClass("z-50");
    expect(document.activeElement).not.toHaveClass("xterm-helper-textarea");
    expect(terminalHarness.focusOrder).toEqual([]);

    expect(shiftTab().defaultPrevented).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("stories");
    expect(stories).toHaveFocus();
    expect(terminalHarness.focusOrder).toEqual([]);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(body).toHaveFocus();
    expect(terminalHarness.focusOrder).toEqual([]);

    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() =>
      expect(document.activeElement).toHaveClass("xterm-helper-textarea"),
    );
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(useUIStore.getState().editViewBodyEngaged).toBe(true);

    const xtermInput = document.activeElement!;
    const ptyKeydown = vi.fn();
    xtermInput.addEventListener("keydown", ptyKeydown);
    const passthroughKeys: KeyboardEventInit[] = [
      { key: "Tab" },
      { key: "Tab", shiftKey: true },
      { key: "Enter" },
      { key: "ArrowUp" },
      { key: "\\", metaKey: true },
      { key: "ArrowRight", metaKey: true },
    ];

    for (const init of passthroughKeys) {
      expect(keydown(xtermInput, init).defaultPrevented).toBe(false);
    }
    expect(ptyKeydown).toHaveBeenCalledTimes(passthroughKeys.length);
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · claude");

    const escape = keydown(xtermInput, {
      key: "Escape",
      metaKey: true,
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(ptyKeydown).toHaveBeenCalledTimes(passthroughKeys.length);
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(useUIStore.getState().editViewBodyEngaged).toBe(false);
    await waitFor(() =>
      expect(
        view.container.querySelector(
          '[data-navigation-zone="active-tab-body"]',
        ),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() =>
      expect(document.activeElement).toHaveClass("xterm-helper-textarea"),
    );
    expect(useUIStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("engages and disengages a document body in place", async () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "doc",
          activeDocId: "design",
        },
      },
    }));
    const view = mountEditView();
    const body = view.container.querySelector<HTMLElement>(
      '[data-navigation-zone="active-tab-body"]',
    )!;
    const frame = await screen.findByTitle("Design");
    const documentKeydown = vi.fn();
    frame.addEventListener("keydown", documentKeydown);

    fireEvent.keyDown(window, { key: "Enter" });
    expect(body).toHaveFocus();
    expect(useUIStore.getState().editViewBodyEngaged).toBe(false);

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(frame).toHaveFocus());
    expect(useUIStore.getState().editViewBodyEngaged).toBe(true);

    expect(
      keydown(frame, { key: "ArrowLeft", metaKey: false }).defaultPrevented,
    ).toBe(false);
    expect(documentKeydown).toHaveBeenCalledTimes(1);

    const escape = keydown(frame, { key: "Escape", metaKey: true });

    expect(escape.defaultPrevented).toBe(true);
    expect(documentKeydown).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(useUIStore.getState().editViewBodyEngaged).toBe(false);
    expect(body).toHaveFocus();
    expect(
      body.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).not.toBeNull();

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(frame).toHaveFocus());
    expect(useUIStore.getState().editViewBodyEngaged).toBe(true);
  });

  it.each([
    ["ArrowUp", "tab-strip"],
    ["ArrowLeft", "stories"],
  ] as const)(
    "Cmd+Escape then %s exits a document body to %s",
    async (key, expectedZone) => {
      useTicketWorkspaceStore.setState((state) => ({
        workspaces: {
          ...state.workspaces,
          [TASK_ID]: {
            ...state.workspaces[TASK_ID],
            active: "doc",
            activeDocId: "design",
          },
        },
      }));
      const view = mountEditView();
      const frame = await screen.findByTitle("Design");

      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.keyDown(window, { key: "Enter" });
      await waitFor(() => expect(frame).toHaveFocus());

      keydown(frame, { key: "Escape", metaKey: true });
      fireEvent.keyDown(window, { key });

      expect(useUIStore.getState().editViewZone).toBe(expectedZone);
      expect(useUIStore.getState().editViewBodyEngaged).toBe(false);
      expect(
        view.container.querySelector(
          `[data-navigation-zone="${expectedZone}"]`,
        ),
      ).toHaveFocus();
    },
  );

  it("shows the engaged terminal ring only while terminal typing mode is active", () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
      },
    }));
    const view = mountEditView();
    // The ring is painted by an overlay stacked above xterm, not by the host
    // wrapper: an inset ring on the wrapper is hidden behind xterm's own
    // opaque background, which is how this shipped invisible once already.
    const ring = view.getByTestId("terminal-mode-ring");
    const wrapper = view.getByTestId("terminal-host-wrapper");

    expect(wrapper).toContainElement(ring);
    expect(ring).toHaveAttribute("data-terminal-mode", "idle");

    act(() => {
      useUIStore.getState().setEditViewZone("active-tab-body");
      useUIStore.getState().setEditViewBodyEngaged(true);
    });

    expect(view.getByTestId("terminal-mode-ring")).toHaveAttribute(
      "data-terminal-mode",
      "engaged",
    );

    act(() => useUIStore.getState().setEditViewBodyEngaged(false));

    expect(view.getByTestId("terminal-mode-ring")).toHaveAttribute(
      "data-terminal-mode",
      "idle",
    );
  });

  it("focuses the newly presented terminal when ticket navigation preserves body engagement", async () => {
    const nextSession = {
      ...session("session-next", "codex"),
      taskId: NEXT_TASK_ID,
      agentRunId: "run-session-next",
    };
    useTerminalStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [nextSession.sessionId]: nextSession,
      },
    }));
    useWorkspaceTabsStore.setState((state) => ({
      byTaskId: {
        ...state.byTaskId,
        [NEXT_TASK_ID]: [nextSession.sessionId],
      },
      activeByTask: {
        ...state.activeByTask,
        [NEXT_TASK_ID]: nextSession.sessionId,
      },
    }));
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
        [NEXT_TASK_ID]: {
          ...DEFAULT_WORKSPACE,
          active: "terminal",
        },
      },
    }));

    const view = mountEditView();
    act(() => {
      useUIStore.getState().setEditViewZone("active-tab-body");
      useUIStore.getState().setEditViewBodyEngaged(true);
    });
    await waitFor(() => expect(terminalHarness.focusOrder).toHaveLength(1));
    const firstTerminal = terminalHarness.focusOrder[0];

    act(() => useTasksStore.setState({ selectedTaskId: NEXT_TASK_ID }));

    await waitFor(() => expect(terminalHarness.focusOrder).toHaveLength(2));
    expect(terminalHarness.focusOrder[1]).not.toBe(firstTerminal);
    expect(useUIStore.getState().editViewBodyEngaged).toBe(true);
    expect(view.getByTestId("terminal-mode-ring")).toHaveAttribute(
      "data-terminal-mode",
      "engaged",
    );
    expect(
      view.container.querySelector(".xterm-helper-textarea"),
    ).toHaveFocus();
  });

  it("distinguishes a selected terminal zone from an entered one while keyboard navigating", () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
      },
    }));
    const view = mountEditView();

    // Selected: the keyboard cursor is on the terminal body, but keys still
    // drive navigation. The shared accent-blue zone ring marks it.
    act(() => {
      useUIStore.getState().setNavigationModality("keyboard");
      useUIStore.getState().setEditViewZone("active-tab-body");
    });

    expect(
      view.getByTestId("terminal-mode-ring"),
    ).toHaveAttribute("data-terminal-mode", "idle");
    expect(
      document.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).not.toBeNull();

    // Entered: keys now go to xterm. The green engaged ring takes over and the
    // blue selection ring is withdrawn, so the two states never look alike.
    act(() => useUIStore.getState().setEditViewBodyEngaged(true));

    expect(
      view.getByTestId("terminal-mode-ring"),
    ).toHaveAttribute("data-terminal-mode", "engaged");
    expect(
      document.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).toBeNull();

    // The exit tag names the way out, on the terminal itself.
    const tag = view.getByTestId("terminal-mode-tag");
    expect(tag).toHaveTextContent("Disengage Body");
    expect(tag).toHaveTextContent("⌘Esc");

    // Leaving terminal mode restores the selection ring.
    act(() => useUIStore.getState().setEditViewBodyEngaged(false));

    expect(
      view.getByTestId("terminal-mode-ring"),
    ).toHaveAttribute("data-terminal-mode", "idle");
    expect(
      document.querySelector('[data-navigation-highlight="active-tab-body"]'),
    ).not.toBeNull();
    expect(view.queryByTestId("terminal-mode-tag")).toBeNull();
  });

  it("enters terminal typing on the first mouse click", async () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
      },
    }));
    const view = mountEditView();
    await waitFor(() =>
      expect(
        view.container.querySelector(".xterm-helper-textarea"),
      ).toBeInTheDocument(),
    );
    const xtermInput = view.container.querySelector<HTMLElement>(
      ".xterm-helper-textarea",
    )!;
    const ptyKeydown = vi.fn();
    xtermInput.addEventListener("keydown", ptyKeydown);

    fireEvent.mouseDown(xtermInput);
    xtermInput.focus();

    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(xtermInput).toHaveFocus();
    expect(terminalHarness.focusOrder).toEqual([0]);

    expect(
      keydown(xtermInput, { key: "a", metaKey: false }).defaultPrevented,
    ).toBe(false);
    expect(ptyKeydown).toHaveBeenCalledTimes(1);

    expect(
      keydown(xtermInput, { key: "Escape", metaKey: true }).defaultPrevented,
    ).toBe(true);
    expect(useUIStore.getState().editViewZone).toBe("active-tab-body");
    expect(useUIStore.getState().editViewBodyEngaged).toBe(false);
    expect(
      view.container.querySelector(
        '[data-navigation-highlight="active-tab-body"]',
      ),
    ).not.toBeNull();
    expect(ptyKeydown).toHaveBeenCalledTimes(1);
  });
});

describe("task workspace manual agent launch", () => {
  it("treats one provider confirmation as one launch while allowing a later launch", () => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {} });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    const claude = screen.getByRole("menuitem", { name: "claude" });
    act(() => {
      claude.click();
      claude.click();
    });

    expect(Object.values(useTerminalStore.getState().sessions)).toEqual([
      expect.objectContaining({
        agent: "claude",
        projectId: "project-1",
        moduleId: "module-1",
        taskId: TASK_ID,
      }),
    ]);
    expect(screen.getByRole("tab", { name: "MEML-3 · claude" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "claude" }));

    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(2);
  });

  // ADR-0015 · CODIN-1432: the launcher grammar is the filtered capabilities
  // payload, so a provider the host deactivated is never offered here.
  it("offers only providers the host has activated", () => {
    setProviderCapabilities([
        {
          agent: "claude",
          accepts_model: true,
          accepts_any_model: false,
          model_aliases: [],
          model_prefixes: [],
          reasoning_levels: [],
        },
      ]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {} });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));

    expect(screen.getByRole("menuitem", { name: "claude" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "codex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "gemini" })).not.toBeInTheDocument();
  });

  // An empty provider list is ambiguous: not loaded yet, a dead fetch, and
  // "nothing activated" all render the same. The menu has to say which rather
  // than open with nothing in it and no explanation.
  it("explains an empty activated-provider list", () => {
    setProviderCapabilities([]);
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useWorkspaceTabsStore.setState({ byTaskId: {}, activeByTask: {} });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "＋ Agent" }));

    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.getByText(/No activated providers/)).toBeInTheDocument();
  });
});

describe("mounted task workspace terminal refresh", () => {
  function persistedSession(
    agentRunId: string,
    taskId = TASK_ID,
    // Restored metadata carries no ticket sequence. The mounted workspace's
    // live work-item key keeps the tab associated with its ticket.
    agent: PersistedTerminalSession["agent"] = "agy",
    terminatedAt: string | null = null,
  ): PersistedTerminalSession {
    return {
      agent_run_id: agentRunId,
      tmux_session_name: `tmux-${agentRunId}`,
      task_id: taskId,
      module_id: "module-1",
      project_id: "project-1",
      agent,
      scope: "task",
      created_at: "2026-07-27T12:00:00Z",
      terminated_at: terminatedAt,
    };
  }

  function dispatchLifecycle(agentRunId: string, taskId = TASK_ID): void {
    act(() => {
      dispatchStatusFrame({
        v: 1,
        type: "agent_lifecycle",
        at: "2026-07-27T12:00:00Z",
        run: {
          agent_run_id: agentRunId,
          task_id: taskId,
          module_id: "module-1",
          scope: "task",
          state: "starting",
          updated_at: "2026-07-27T12:00:00Z",
        },
      });
    });
  }

  it("adds same-task spawned terminals quietly and ignores repeated or foreign lifecycle frames", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(selectedTab()).toHaveAccessibleName("Notes");

    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("spawned-run"),
    ]);
    dispatchLifecycle("spawned-run");

    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "MEML-3 · agy" })).toHaveLength(1),
    );
    expect(selectedTab()).toHaveAccessibleName("Notes");

    dispatchLifecycle("spawned-run");
    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("spawned-run"),
    ]);
    dispatchLifecycle("second-spawn");
    dispatchLifecycle("foreign-run", NEXT_TASK_ID);

    await act(async () => {});
    expect(screen.getAllByRole("tab", { name: "MEML-3 · agy" })).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName("Notes");

    vi.mocked(agentApi.getTerminals).mockRejectedValueOnce(
      new Error("terminal listing unavailable"),
    );
    dispatchLifecycle("failed-refresh-run");

    await act(async () => {});
    expect(screen.getAllByRole("tab", { name: "MEML-3 · agy" })).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName("Notes");
  });

  it("keeps a tab closed for a still-live run closed, and only that run", async () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("dismissed-run"),
    ]);
    dispatchLifecycle("dismissed-run");
    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "MEML-3 · agy" })).toHaveLength(1),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close terminal MEML-3 · agy" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "MEML-3 · agy" })).toBeNull(),
    );

    // The server still lists the closed run as live — the next spawn's
    // re-fetch races the kill, or the close never killed anything at all. The
    // dismissed tab must not come back, while the run alongside it, which was
    // never dismissed, must still get its tab.
    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("dismissed-run"),
      persistedSession("fresh-run", TASK_ID, "gemini"),
    ]);
    dispatchLifecycle("fresh-run");

    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "MEML-3 · gemini" })).toHaveLength(1),
    );
    expect(screen.queryByRole("tab", { name: "MEML-3 · agy" })).toBeNull();
    expect(selectedTab()).toHaveAccessibleName("Notes");

    // Once the server reports that run ended, the dismissal is spent: it is no
    // longer remembered, so it cannot suppress anything the server later says
    // is live again.
    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("dismissed-run", TASK_ID, "agy", "2026-07-27T12:05:00Z"),
      persistedSession("fresh-run", TASK_ID, "gemini"),
    ]);
    dispatchLifecycle("ended-run");
    await act(async () => {});
    expect(screen.queryByRole("tab", { name: "MEML-3 · agy" })).toBeNull();

    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([
      persistedSession("dismissed-run"),
      persistedSession("fresh-run", TASK_ID, "gemini"),
    ]);
    dispatchLifecycle("relisted-run");
    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "MEML-3 · agy" })).toHaveLength(1),
    );
    expect(selectedTab()).toHaveAccessibleName("Notes");
  });
});

describe("mounted scratch workspace terminal refresh", () => {
  function scratchPane(moduleId: string) {
    return (
      <SelectedTicketContent
        bucket={scratchBucketId(moduleId)}
        projectId="project-1"
        moduleId={moduleId}
        owner="drawer"
        details={<div>Scratch details</div>}
      />
    );
  }

  function scratchSession(
    agentRunId: string,
    moduleId = "module-1",
    scope: "plan" | "instant" = "plan",
  ): PersistedTerminalSession {
    return {
      agent_run_id: agentRunId,
      tmux_session_name: `tmux-${agentRunId}`,
      task_id: SCRATCH_RUN_TASK_ID,
      module_id: moduleId,
      project_id: "project-1",
      agent: "agy",
      scope,
      created_at: "2026-07-27T12:00:00Z",
      terminated_at: null,
    };
  }

  function dispatchScratchLifecycle(
    agentRunId: string,
    moduleId = "module-1",
    scope: "plan" | "instant" = "plan",
  ): void {
    act(() => {
      dispatchStatusFrame({
        v: 1,
        type: "agent_lifecycle",
        at: "2026-07-27T12:00:00Z",
        run: {
          agent_run_id: agentRunId,
          task_id: null,
          module_id: moduleId,
          scope,
          state: "starting",
          updated_at: "2026-07-27T12:00:00Z",
        },
      });
    });
  }

  it("adds spawned scratch terminals quietly and ignores repeated or failed refreshes", async () => {
    localStorage.clear();
    render(scratchPane("module-1"));
    expect(selectedTab()).toHaveAccessibleName("Details");

    vi.mocked(agentApi.getScratchTerminals).mockResolvedValueOnce([
      scratchSession("plan-run"),
    ]);
    dispatchScratchLifecycle("plan-run");

    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "plan" })).toHaveLength(1),
    );
    expect(selectedTab()).toHaveAccessibleName("Details");

    // A repeated frame for the same run is inert, and a re-fetch that returns
    // the run again reconciles onto the tab that already holds it.
    dispatchScratchLifecycle("plan-run");
    vi.mocked(agentApi.getScratchTerminals).mockResolvedValueOnce([
      scratchSession("plan-run"),
    ]);
    dispatchScratchLifecycle("second-plan-run");

    await act(async () => {});
    expect(screen.getAllByRole("tab", { name: "plan" })).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName("Details");

    vi.mocked(agentApi.getScratchTerminals).mockRejectedValueOnce(
      new Error("scratch terminal listing unavailable"),
    );
    dispatchScratchLifecycle("instant-run", "module-1", "instant");

    await act(async () => {});
    expect(screen.getAllByRole("tab", { name: "plan" })).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName("Details");

    // A scratch tab closed while its run is still live stays closed, even
    // though the next spawn's re-fetch still lists that run as alive.
    act(() => {
      const closed =
        useWorkspaceTabsStore.getState().byTaskId[scratchBucketId("module-1")]![0];
      useTerminalStore.getState().closeTab(closed);
    });
    expect(screen.queryByRole("tab", { name: "plan" })).toBeNull();

    vi.mocked(agentApi.getScratchTerminals).mockResolvedValueOnce([
      scratchSession("plan-run"),
      scratchSession("later-run", "module-1", "instant"),
    ]);
    dispatchScratchLifecycle("later-run", "module-1", "instant");

    await waitFor(() =>
      expect(screen.getAllByRole("tab", { name: "instant" })).toHaveLength(1),
    );
    expect(screen.queryByRole("tab", { name: "plan" })).toBeNull();
  });

  it("keeps a spawn in one module out of another module's scratch strip", async () => {
    render(
      <>
        {scratchPane("module-1")}
        {scratchPane("module-2")}
      </>,
    );
    const [moduleOne, moduleTwo] = screen.getAllByRole("tablist");

    vi.mocked(agentApi.getScratchTerminals).mockResolvedValueOnce([
      scratchSession("module-one-run"),
    ]);
    dispatchScratchLifecycle("module-one-run");

    await waitFor(() =>
      expect(within(moduleOne).getAllByRole("tab", { name: "plan" })).toHaveLength(1),
    );
    expect(within(moduleTwo).queryByRole("tab", { name: "plan" })).toBeNull();

    vi.mocked(agentApi.getScratchTerminals).mockResolvedValueOnce([
      scratchSession("module-two-run", "module-2"),
    ]);
    dispatchScratchLifecycle("module-two-run", "module-2");

    await waitFor(() =>
      expect(within(moduleTwo).getAllByRole("tab", { name: "plan" })).toHaveLength(1),
    );
    expect(within(moduleOne).getAllByRole("tab", { name: "plan" })).toHaveLength(1);
  });
});

describe("task workspace Command-arrow navigation", () => {
  beforeEach(() => {
    useUIStore.setState({ focusedPane: "details-or-terminal" });
  });

  it("does not consume Command-arrow before a task workspace is rendered", () => {
    mount(null);

    const event = keydown(window);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("traverses Details, open documents, and terminals in rendered order in both directions", async () => {
    mount();

    expect(selectedTab()).toHaveAccessibleName("Details");
    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("Design");
    keydown(window, { repeat: true });
    expect(selectedTab()).toHaveAccessibleName("Notes");
    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · claude");
    await waitFor(() => expect(terminalHarness.focusOrder).toEqual([0]));
    expect(document.activeElement).toHaveClass("xterm-helper-textarea");

    const xtermInput = document.activeElement!;
    const ptyKeydown = vi.fn();
    xtermInput.addEventListener("keydown", ptyKeydown);

    const arrowEvent = keydown(xtermInput, { key: "ArrowUp", metaKey: false });
    const escapeEvent = keydown(xtermInput, { key: "Escape", metaKey: false });
    expect(arrowEvent.defaultPrevented).toBe(false);
    expect(escapeEvent.defaultPrevented).toBe(false);
    expect(ptyKeydown).toHaveBeenCalledTimes(2);

    const terminalEvent = keydown(xtermInput);

    expect(terminalEvent.defaultPrevented).toBe(true);
    expect(ptyKeydown).toHaveBeenCalledTimes(2);
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex");
    expect(terminalHarness.focusOrder).toEqual([0, 1]);

    keydown(window, { key: "ArrowLeft" });
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · claude");
    keydown(window, { key: "ArrowLeft" });
    expect(selectedTab()).toHaveAccessibleName("Notes");
    keydown(window, { key: "ArrowLeft" });
    expect(selectedTab()).toHaveAccessibleName("Design");
    keydown(window, { key: "ArrowLeft" });
    expect(selectedTab()).toHaveAccessibleName("Details");
  });

  it("clamps at both boundaries while consuming every accepted keydown", () => {
    mount();

    const first = keydown(window, { key: "ArrowLeft" });
    expect(first.defaultPrevented).toBe(true);
    expect(selectedTab()).toHaveAccessibleName("Details");

    for (let index = 0; index < 4; index += 1) keydown(window);
    const last = keydown(window, { repeat: true });
    expect(last.defaultPrevented).toBe(true);
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex");
  });

  it("focuses the Details and document scroll surfaces when landing on those stops", async () => {
    mount(TASK_ID, 1);

    expect(screen.getByTestId("workspace-details-surface")).toHaveFocus();

    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("Design");
    await waitFor(() => expect(screen.getByTitle("Design")).toHaveFocus());
  });

  it("renders an already-active terminal without focusing it until the stop is engaged", async () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "terminal",
        },
      },
    }));

    mount();

    await waitFor(() => expect(screen.getByTestId("terminal-host")).toBeInTheDocument());
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · claude");
    expect(terminalHarness.focusOrder).toEqual([]);
    expect(document.activeElement).not.toHaveClass("xterm-helper-textarea");
  });

  it("leaves editable targets and non-exact shortcuts untouched", () => {
    mount();

    const editableTargets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      document.createElement("div"),
    ];
    editableTargets[3].setAttribute("contenteditable", "true");
    Object.defineProperty(editableTargets[3], "isContentEditable", {
      configurable: true,
      value: true,
    });

    for (const target of editableTargets) {
      document.body.appendChild(target);
      const event = keydown(target);
      expect(event.defaultPrevented).toBe(false);
      expect(selectedTab()).toHaveAccessibleName("Details");
      target.remove();
    }

    const variants: KeyboardEventInit[] = [
      { metaKey: false },
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { key: "ArrowUp" },
    ];
    for (const variant of variants) {
      keydown(window, variant);
      expect(selectedTab()).toHaveAccessibleName("Details");
    }
  });

  it("excludes dormant and overlay controls and preserves document/session lifecycle state", () => {
    mount();

    // Prime both already-open terminal sessions, then return to Details. The
    // navigation under test must only select/focus these existing sessions.
    fireEvent.click(screen.getByRole("tab", { name: "MEML-3 · claude" }));
    fireEvent.click(screen.getByRole("tab", { name: "MEML-3 · codex" }));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    terminalHarness.socketOpen.mockClear();
    terminalHarness.transportResume.mockClear();

    const sessionsBefore = useTerminalStore.getState().sessions;
    const tabsBefore = useWorkspaceTabsStore.getState().byTaskId[TASK_ID];

    expect(screen.getByRole("button", { name: "Reopen Closed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "↻ gemini" })).toBeInTheDocument();
    expect(screen.getByText("old run ✕")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent/ })).toBeInTheDocument();

    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("Design");
    expect(screen.getByRole("button", { name: "Close agent overlay" })).toBeInTheDocument();
    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("Notes");
    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · claude");
    keydown(window);
    expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex");

    const workspace = useTicketWorkspaceStore.getState().workspaces[TASK_ID];
    expect(workspace.overlayOpenByDoc.design).toBe(true);
    expect(workspace.docs.find((entry) => entry.docId === "closed")?.open).toBe(false);
    expect(workspace.history).toEqual([
      { label: "old run", agent: "claude", agentRunId: "old-run" },
    ]);
    expect(useTerminalStore.getState().sessions).toEqual(sessionsBefore);
    expect(useWorkspaceTabsStore.getState().byTaskId[TASK_ID]).toEqual(tabsBefore);
    expect(agentApi.resumeTerminal).not.toHaveBeenCalled();
    expect(agentApi.terminateTerminal).not.toHaveBeenCalled();
    expect(terminalHarness.socketOpen).not.toHaveBeenCalled();
    expect(terminalHarness.transportResume).not.toHaveBeenCalled();
    expect(terminalHarness.socketClose).not.toHaveBeenCalled();
  });
});

describe("Studio workspace context restoration", () => {
  it("restores a remembered terminal while the Stories pane keeps focus and arrow navigation", async () => {
    useTerminalStore.setState((state) => ({
      ...state,
      sessionByRun: { "run-session-2": "session-2" },
    }));
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [TASK_ID]: { kind: "terminal", agentRunId: "run-session-2" },
      }),
    );

    const view = render(
      <>
        <TaskKeymapHarness />
        <PaneShell pane="tasks">Task list</PaneShell>
        <PaneShell pane="details-or-terminal">
          <SelectedTaskWorkspace />
        </PaneShell>
      </>,
    );

    await waitFor(() =>
      expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex"),
    );
    expect(document.activeElement).toBe(
      view.container.querySelector('[data-pane="tasks"]'),
    );
    expect(useUIStore.getState().focusedPane).toBe("tasks");
    expect(terminalHarness.focusOrder).toEqual([]);

    const terminalTab = screen.getByRole("tab", { name: "MEML-3 · codex" });
    fireEvent.pointerDown(terminalTab);
    fireEvent.mouseDown(terminalTab);
    fireEvent.click(terminalTab);
    await waitFor(() =>
      expect(document.activeElement).toHaveClass("xterm-helper-textarea"),
    );
    expect(useUIStore.getState().focusedPane).toBe("details-or-terminal");

    terminalHarness.focusOrder.length = 0;
    act(() => useUIStore.setState({ focusedPane: "tasks" }));
    expect(document.activeElement).toBe(
      view.container.querySelector('[data-pane="tasks"]'),
    );

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(useTasksStore.getState().selectedTaskId).toBe(NEXT_TASK_ID);
    await waitFor(() => expect(selectedTab()).toHaveAccessibleName("Details"));

    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(useTasksStore.getState().selectedTaskId).toBe(TASK_ID);
    await waitFor(() =>
      expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex"),
    );
    expect(document.activeElement).toBe(
      view.container.querySelector('[data-pane="tasks"]'),
    );
    expect(useUIStore.getState().focusedPane).toBe("tasks");
    expect(terminalHarness.focusOrder).toEqual([]);
  });

  it("migrates the legacy workspace tab selection", async () => {
    const remembered = JSON.stringify({
      [TASK_ID]: { kind: "doc", relPath: "spec/notes.html" },
    });
    localStorage.setItem("studio.coding.activeWorkspaceByBucket", remembered);
    vi.mocked(agentApi.getDocuments).mockResolvedValueOnce({
      documents: [
        {
          id: "notes",
          rel_path: "spec/notes.html",
          label: "Notes",
        },
      ],
    });

    mount(TASK_ID, 0, "studio");

    await waitFor(() =>
      expect(selectedTab().getAttribute("aria-label")).toBe("notes"),
    );
    expect(localStorage.getItem("studio.activeWorkspaceByBucket:v1")).toBe(
      remembered,
    );
  });

  it("restores Details immediately", () => {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [TASK_ID]: {
          ...state.workspaces[TASK_ID],
          active: "doc",
          activeDocId: "design",
        },
      },
    }));
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({ [TASK_ID]: { kind: "details" } }),
    );

    mount(TASK_ID, 0, "studio");

    expect(selectedTab()).toHaveAccessibleName("Details");
  });

  it("waits for document hydration before restoring by relative path", async () => {
    useTicketWorkspaceStore.setState({ workspaces: {} });
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [TASK_ID]: { kind: "doc", relPath: "spec/remembered.html" },
      }),
    );
    let resolveDocuments!: (value: {
      documents: { id: string; rel_path: string; label: string }[];
    }) => void;
    vi.mocked(agentApi.getDocuments).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDocuments = resolve;
      }),
    );

    mount(TASK_ID, 0, "studio");
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(screen.getByTestId("workspace-details-surface")).toHaveTextContent(
      "Task details",
    );
    expect(screen.queryByTestId("workspace-restore-skeleton")).toBeNull();

    resolveDocuments({
      documents: [
        {
          id: "hydrated-doc",
          rel_path: "spec/remembered.html",
          label: "Remembered",
        },
      ],
    });

    await waitFor(() => expect(selectedTab()).toHaveAccessibleName("remembered"));
    expect(screen.getAllByRole("tab", { name: "remembered" })).toHaveLength(1);
  });

  it("waits for live-session reattachment before restoring by agent run", async () => {
    useTicketWorkspaceStore.setState({ workspaces: {} });
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
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [TASK_ID]: { kind: "terminal", agentRunId: "remembered-run" },
      }),
    );
    let resolveSessions!: (value: PersistedTerminalSession[]) => void;
    vi.mocked(agentApi.getTerminals).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSessions = resolve;
      }),
    );
    vi.mocked(agentApi.listResumableTerminals).mockResolvedValueOnce([]);

    mount(TASK_ID, 0, "studio");
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(screen.getByTestId("workspace-details-surface")).toHaveTextContent(
      "Task details",
    );
    expect(screen.queryByTestId("workspace-restore-skeleton")).toBeNull();

    resolveSessions([
      {
        agent_run_id: "remembered-run",
        tmux_session_name: "tmux-remembered",
        task_id: TASK_ID,
        module_id: "module-1",
        project_id: "project-1",
        agent: "codex",
        scope: "task",
        created_at: "2026-07-16T00:00:00Z",
        terminated_at: null,
      },
    ]);

    await waitFor(() =>
      expect(selectedTab()).toHaveAccessibleName("MEML-3 · codex"),
    );
    expect(screen.getAllByRole("tab", { name: "MEML-3 · codex" })).toHaveLength(1);
    expect(
      Object.values(useTerminalStore.getState().sessions).filter(
        (entry) => entry.agentRunId === "remembered-run",
      ),
    ).toHaveLength(1);
  });

  it("falls back to Details when a stored document is missing", async () => {
    useTicketWorkspaceStore.setState({ workspaces: {} });
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [TASK_ID]: { kind: "doc", relPath: "spec/deleted.html" },
      }),
    );
    vi.mocked(agentApi.getDocuments).mockResolvedValueOnce({ documents: [] });

    mount(TASK_ID, 0, "studio");

    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
      ).toEqual({ [TASK_ID]: { kind: "details" } }),
    );
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(screen.queryByTestId("workspace-doc-frame")).not.toBeInTheDocument();
  });

  it("falls back to Details when a stored agent run is missing", async () => {
    useTicketWorkspaceStore.setState({ workspaces: {} });
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
    localStorage.setItem(
      "studio.activeWorkspaceByBucket:v1",
      JSON.stringify({
        [TASK_ID]: { kind: "terminal", agentRunId: "deleted-run" },
      }),
    );
    vi.mocked(agentApi.getTerminals).mockResolvedValueOnce([]);
    vi.mocked(agentApi.listResumableTerminals).mockResolvedValueOnce([]);

    mount(TASK_ID, 0, "studio");

    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
      ).toEqual({ [TASK_ID]: { kind: "details" } }),
    );
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(useWorkspaceTabsStore.getState().byTaskId[TASK_ID]).toBeUndefined();
  });

  it("persists Studio tab identity without accepting drawer changes", () => {
    localStorage.setItem(
      "studio.studio.selectedTaskByModule",
      JSON.stringify({ "module-1": TASK_ID }),
    );
    const studio = mount(TASK_ID, 0, "studio");
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    const remembered = localStorage.getItem("studio.activeWorkspaceByBucket:v1");
    expect(JSON.parse(remembered!)).toEqual({
      [TASK_ID]: { kind: "doc", relPath: "spec/notes.html" },
    });

    const drawer = mount(TASK_ID, 0, "drawer");
    fireEvent.click(within(drawer.container).getByRole("tab", { name: "Details" }));
    fireEvent.click(
      within(drawer.container).getByRole("tab", { name: "MEML-3 · codex" }),
    );

    expect(localStorage.getItem("studio.activeWorkspaceByBucket:v1")).toBe(
      remembered,
    );
    expect(localStorage.getItem("studio.studio.selectedTaskByModule")).toBe(
      JSON.stringify({ "module-1": TASK_ID }),
    );
    studio.unmount();
  });

  it("persists terminals by durable agent run identity", () => {
    mount(TASK_ID, 0, "studio");

    fireEvent.click(screen.getByRole("tab", { name: "MEML-3 · codex" }));

    expect(
      JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
    ).toEqual({
      [TASK_ID]: { kind: "terminal", agentRunId: "run-session-2" },
    });
  });

  it("remembers tab changes caused by closing and reopening", () => {
    mount(TASK_ID, 0, "studio");
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));

    fireEvent.click(screen.getByRole("button", { name: "Close Notes" }));
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(
      JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
    ).toEqual({ [TASK_ID]: { kind: "details" } });

    fireEvent.click(screen.getByRole("button", { name: "Reopen Notes" }));
    expect(selectedTab()).toHaveAccessibleName("Notes");
    expect(
      JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
    ).toEqual({
      [TASK_ID]: { kind: "doc", relPath: "spec/notes.html" },
    });
  });

  it("remembers the next tab when the active terminal closes", () => {
    mount(TASK_ID, 0, "studio");
    fireEvent.click(screen.getByRole("tab", { name: "MEML-3 · claude" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close terminal MEML-3 · claude",
      }),
    );

    expect(
      JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
    ).toEqual({
      [TASK_ID]: { kind: "terminal", agentRunId: "run-session-2" },
    });
  });

  it("remembers a resumed terminal by its new durable run identity", async () => {
    const resumed: PersistedTerminalSession = {
      agent_run_id: "resumed-run",
      tmux_session_name: "tmux-resumed",
      task_id: TASK_ID,
      module_id: "module-1",
      project_id: "project-1",
      agent: "gemini",
      scope: "task",
      created_at: "2026-07-16T00:00:00Z",
      terminated_at: null,
    };
    vi.mocked(agentApi.resumeTerminal).mockResolvedValueOnce({
      agent_run_id: "resumed-run",
      resumed_from: "dormant-run",
    });
    vi.mocked(agentApi.getTerminals)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([resumed]);
    vi.mocked(agentApi.listResumableTerminals).mockResolvedValue(
      useTerminalStore.getState().resumableSessions[TASK_ID],
    );
    mount(TASK_ID, 0, "studio");

    // The initial discovery is debounced; let it settle before exercising the
    // independent explicit-resume flow.
    await waitFor(() =>
      expect(agentApi.getTerminals).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByRole("button", { name: "↻ gemini" }));

    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1")!),
      ).toEqual({
        [TASK_ID]: { kind: "terminal", agentRunId: "resumed-run" },
      }),
    );
    expect(screen.getAllByRole("tab", { name: "MEML-3 · gemini" })).toHaveLength(1);
  });

  it("keeps Studio usable with malformed or unavailable workspace storage", () => {
    localStorage.setItem("studio.activeWorkspaceByBucket:v1", "not-json");
    const malformed = mount(TASK_ID, 0, "studio");
    expect(selectedTab()).toHaveAccessibleName("Details");
    expect(() => fireEvent.click(screen.getByRole("tab", { name: "Notes" }))).not.toThrow();
    malformed.unmount();

    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => mount(TASK_ID, 0, "studio")).not.toThrow();
    expect(() => fireEvent.click(screen.getByRole("tab", { name: "Details" }))).not.toThrow();
  });
});

describe("focus-based Command-arrow workspace routing", () => {
  const TASK_B = "task-b";

  function seedExtraWorkspace(taskId: string, docLabel: string) {
    useTicketWorkspaceStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [taskId]: {
          ...DEFAULT_WORKSPACE,
          docs: [doc(`${taskId}-doc`, docLabel)],
        },
      },
    }));
  }

  function pane(
    testId: string,
    bucket: string | null,
    modal = false,
  ) {
    return (
      <section data-testid={testId}>
        <SelectedTicketContent
          bucket={bucket}
          projectId="project-1"
          moduleId="module-1"
          owner="drawer"
          modal={modal}
          details={<div>{testId} details</div>}
        />
      </section>
    );
  }

  function mountPair(drawerOpen = false) {
    seedExtraWorkspace(TASK_B, "Brief");
    return render(
      <>
        <TaskKeymapHarness />
        {pane("pane-a", TASK_ID)}
        {pane("pane-b", TASK_B, drawerOpen)}
      </>,
    );
  }

  function selectedTabIn(testId: string): HTMLElement {
    return within(screen.getByTestId(testId))
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true")!;
  }

  it("routes to the Studio workspace only while its pane is focused", () => {
    render(
      <>
        <TaskKeymapHarness />
        {pane("pane-a", TASK_ID)}
      </>,
    );

    const unfocused = keydown(window);
    expect(unfocused.defaultPrevented).toBe(false);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Details");

    act(() => useUIStore.setState({ focusedPane: "details-or-terminal" }));
    const focused = keydown(window);
    expect(focused.defaultPrevented).toBe(true);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Design");
  });

  it("gives an open drawer modal ownership over a focused background workspace", () => {
    mountPair(true);

    const backgroundTabs = within(screen.getByTestId("pane-a")).getByTestId(
      "workspace-tabs",
    );
    const clamped = keydown(backgroundTabs, { key: "ArrowLeft" });
    expect(clamped.defaultPrevented).toBe(true);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Details");
    expect(selectedTabIn("pane-b")).toHaveAccessibleName("Details");

    keydown(backgroundTabs);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Details");
    expect(selectedTabIn("pane-b")).toHaveAccessibleName("Brief");
  });

  it("consumes the axis while the modal drawer workspace is still loading", () => {
    render(
      <>
        <TaskKeymapHarness />
        {pane("pane-a", TASK_ID)}
        {pane("pane-b", null, true)}
      </>,
    );

    const backgroundTabs = within(screen.getByTestId("pane-a")).getByTestId(
      "workspace-tabs",
    );
    const event = keydown(backgroundTabs);
    expect(event.defaultPrevented).toBe(true);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Details");
    expect(within(screen.getByTestId("pane-b")).queryByRole("tab")).toBeNull();
  });

  it("returns routing to the focused Studio workspace when the drawer closes", () => {
    const { rerender } = mountPair(true);
    keydown(window);
    expect(selectedTabIn("pane-b")).toHaveAccessibleName("Brief");

    rerender(
      <>
        <TaskKeymapHarness />
        {pane("pane-a", TASK_ID)}
      </>,
    );
    act(() => useUIStore.setState({ focusedPane: "details-or-terminal" }));

    const event = keydown(window);
    expect(event.defaultPrevented).toBe(true);
    expect(selectedTabIn("pane-a")).toHaveAccessibleName("Design");
  });
});
