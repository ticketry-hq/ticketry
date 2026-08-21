import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectLiveWorkItemRun,
} from "../app/navigation/workItemActivation";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { SelectedTicketContent } from "../app/shell/ticket-workspace/selected-ticket/SelectedTicketContent";
import type { TreeRow } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { useAgentStatusStore, type RunRecord } from "../features/agents/status";
import { useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { registerTerminalFocus } from "../features/agents/terminal/internal/terminalRegistry";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { setProviderCapabilities } from "../features/workflows/providerQueries";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { setStatesSorted } from "../shared/query/stateCatalog";
import { useClientStore } from "../state/clientStore";
import { workItem } from "./seam";

const terminalApi = vi.hoisted(() => ({
  createTerminalRun: vi.fn(),
  getDocuments: vi.fn(),
  getTerminals: vi.fn(),
  listResumableTerminals: vi.fn(),
}));

const providerApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
}));

const directLaunchApi = vi.hoisted(() => ({
  launchAgent: vi.fn(),
}));

vi.mock("@worktracker/typescript-sdk/agent-status", () => ({
  createAgentStatusClient: () => directLaunchApi,
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...providerApi,
}));

vi.mock("xterm", () => ({
  Terminal: class {
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {},
}));

vi.mock(
  "../app/shell/ticket-workspace/selected-ticket/terminals/SelectedTicketTerminal",
  () => ({
    SelectedTicketTerminal: ({ bucket }: { bucket: string }) => (
      <div data-testid="selected-ticket-terminal">{bucket}</div>
    ),
  }),
);

const TASK_ID = "story-live";
const PROJECT_ID = "project-live";
const MODULE_ID = "module-live";
const ROWS: TreeRow[] = [{
  kind: "work-item",
  id: TASK_ID,
  depth: 0,
  parentId: null,
  expandable: false,
  expanded: false,
}];

function run(
  id: string,
  state: RunRecord["state"] = "working",
  startedAt = "2026-08-19T12:00:00Z",
): RunRecord {
  return {
    agent_run_id: id,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    module_id: MODULE_ID,
    agent: "codex",
    scope: "task",
    state,
    started_at: startedAt,
    updated_at: startedAt,
  };
}

function session(runId: string, sessionId = `session-${runId}`): SessionMeta {
  return {
    sessionId,
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    moduleId: MODULE_ID,
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: runId,
  };
}

function KeymapHarness() {
  useGlobalKeymap(ROWS);
  return null;
}

function workspace(sidebarVisible: boolean) {
  useClientStore.setState({
    sidebarVisible,
    focusedPane: "tasks",
    editViewZone: "stories",
    editViewBodyEngaged: false,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KeymapHarness />
      <ModalHost />
      <SelectedTicketContent
        bucket={TASK_ID}
        projectId={PROJECT_ID}
        moduleId={MODULE_ID}
        owner="studio"
        details={<div>Story details</div>}
      />
    </QueryClientProvider>,
  );
}

function pressEnter(shiftKey = false): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey,
      bubbles: true,
      cancelable: true,
    }));
  });
}

describe("overhaul acceptance - live work-item activation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    queryClient.clear();
    seedConfig({ features: { sidebar: true, projects: true } });
    useStudioStore.setState({ selectedProjectId: PROJECT_ID });
    useClientStore.setState({
      selectedModuleId: MODULE_ID,
      selectedTaskId: TASK_ID,
      workspaceSelection: { kind: "task" },
      focusedPane: "tasks",
      sidebarVisible: true,
      editViewZone: "stories",
      editViewBodyEngaged: false,
      navigationModality: "keyboard",
      storySearchQuery: "",
      workspaces: {
        [TASK_ID]: { active: "details", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: {},
      modalStack: [],
      toasts: [],
    });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useAgentStatusStore.setState({
      projectId: PROJECT_ID,
      runs: {},
      automationAttempts: {},
      automationByTask: {},
    });

    const item = workItem({ id: TASK_ID, state: "todo", rank: "A" });
    queryClient.setQueryData(queryKeys.workItems.byId(TASK_ID), item);
    queryClient.setQueryData(queryKeys.tasks.byModule(PROJECT_ID, MODULE_ID), {
      rootIds: [TASK_ID],
      children: { [TASK_ID]: [] },
      order: [TASK_ID],
    });
    setStatesSorted(PROJECT_ID, [{
      id: "todo",
      name: "Todo",
      group: "backlog",
      color: null,
      sort_order: 0,
    }]);
    terminalApi.getDocuments.mockResolvedValue({ documents: [] });
    terminalApi.getTerminals.mockResolvedValue([]);
    terminalApi.listResumableTerminals.mockResolvedValue([]);
    terminalApi.createTerminalRun.mockResolvedValue({
      agent_run_id: "run-provider-choice",
    });
    const capabilities = [{ agent: "codex", models: [] }];
    providerApi.getLaunchProviderCapabilities.mockResolvedValue(capabilities);
    setProviderCapabilities(capabilities);
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-147] routes Shift+Enter to provider choice in Stories and prompt entry in the other Edit view zones", async () => {
    seedModuleLinks([{
      id: "module-link-live",
      module_id: MODULE_ID,
      local_path: "/tmp/module-live",
      created_at: "2026-08-19T12:00:00Z",
      updated_at: "2026-08-19T12:00:00Z",
    }]);
    const editView = workspace(false);
    for (const zone of [
      "tab-strip",
      "active-tab-body",
      "terminal-panel",
    ] as const) {
      useClientStore.getState().setEditViewZone(zone);
      useClientStore.getState().setEditViewBodyEngaged(false);
      pressEnter(true);

      expect(useModalStore.getState().modalStack.at(-1)).toMatchObject({
        type: "prompt-input",
        payload: {
          next: "agent-picker",
          nextPayload: {
            mode: "open-with-prompt",
            projectId: PROJECT_ID,
            moduleId: MODULE_ID,
            taskId: TASK_ID,
          },
        },
      });
      expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
      useModalStore.getState().popModal();
    }
    editView.unmount();
    useClientStore.getState().setEditViewZone("stories");

    const fullSidebar = workspace(true);
    const selectionBeforeCancel = {
      active: useClientStore.getState().workspaces[TASK_ID]?.active,
      sessions: Object.keys(useTerminalStore.getState().sessions),
      runs: Object.keys(useAgentStatusStore.getState().runs),
    };

    pressEnter(true);

    let dialog = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(useModalStore.getState().modalStack.at(-1)).toMatchObject({
      type: "agent-picker",
      payload: {
        mode: "open",
        projectId: PROJECT_ID,
        moduleId: MODULE_ID,
        taskId: TASK_ID,
      },
    });
    expect(screen.queryByRole("dialog", { name: /prompt/i })).toBeNull();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect({
      active: useClientStore.getState().workspaces[TASK_ID]?.active,
      sessions: Object.keys(useTerminalStore.getState().sessions),
      runs: Object.keys(useAgentStatusStore.getState().runs),
    }).toEqual(selectionBeforeCancel);
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();

    fullSidebar.unmount();
    workspace(false);
    pressEnter(true);

    dialog = await screen.findByRole("dialog", { name: "Select Agent" });
    expect(within(dialog).getByRole("button", { name: "codex" })).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "claude" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "codex" }));

    await waitFor(() => {
      expect(Object.values(useTerminalStore.getState().sessions))
        .toHaveLength(1);
    });
    expect(Object.values(useTerminalStore.getState().sessions)[0])
      .toMatchObject({
        agent: "codex",
        projectId: PROJECT_ID,
        moduleId: MODULE_ID,
        taskId: TASK_ID,
        initialPrompt: null,
        isPlanning: false,
        isInstant: false,
      });

  });

  it("[overhaul-141] reveals the attached live terminal from both Stories layouts without transferring keyboard ownership", async () => {
    const live = run("run-attached");
    const attached = session(live.agent_run_id);
    const focusTerminal = vi.fn();
    const releaseTerminalFocus = registerTerminalFocus(
      attached.sessionId,
      focusTerminal,
    );
    useAgentStatusStore.setState({ runs: { [live.agent_run_id]: live } });
    useTerminalStore.setState({
      sessions: { [attached.sessionId]: attached },
      sessionByRun: { [live.agent_run_id]: attached.sessionId },
    });
    useClientStore.setState({ activeByTask: { [TASK_ID]: attached.sessionId } });

    const fullSidebar = workspace(true);
    await waitFor(() => expect(terminalApi.getTerminals).toHaveBeenCalled());
    terminalApi.getTerminals.mockClear();
    pressEnter();

    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useClientStore.getState().focusedPane).toBe("tasks");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    expect(focusTerminal).not.toHaveBeenCalled();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    expect(terminalApi.getTerminals).not.toHaveBeenCalled();

    fullSidebar.unmount();
    useClientStore.getState().setActive(TASK_ID, "details");
    workspace(false);
    pressEnter();

    expect(screen.getByRole("tab", { name: "codex terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(useClientStore.getState().editViewZone).toBe("stories");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    expect(focusTerminal).not.toHaveBeenCalled();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    releaseTerminalFocus();
  });

  it("reopens a deliberately closed viewer from its persisted session", async () => {
    const live = run("run-closed");
    const closed = session(live.agent_run_id);
    useAgentStatusStore.setState({ runs: { [live.agent_run_id]: live } });
    useTerminalStore.setState({
      sessions: { [closed.sessionId]: closed },
      sessionByRun: { [live.agent_run_id]: closed.sessionId },
    });
    useTerminalStore.getState().closeTab(closed.sessionId);
    terminalApi.getTerminals.mockResolvedValue([{
      agent_run_id: live.agent_run_id,
      created_at: live.started_at!,
    }]);

    workspace(true);
    await waitFor(() => expect(terminalApi.getTerminals).toHaveBeenCalled());
    terminalApi.getTerminals.mockClear();
    pressEnter();

    await waitFor(() => {
      const restoredId = useTerminalStore.getState().sessionByRun[live.agent_run_id];
      expect(restoredId).toBeTruthy();
      expect(useClientStore.getState().activeByTask[TASK_ID]).toBe(restoredId);
    });
    expect(useClientStore.getState().workspaces[TASK_ID]?.active).toBe("terminal");
    expect(terminalApi.getTerminals).toHaveBeenCalledOnce();
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
  });

  it("preserves a selected live run, then uses newest start time and durable identity", () => {
    const old = run("run-z", "needs_input", "2026-08-19T10:00:00Z");
    const tiedA = run("run-a", "working", "2026-08-19T11:00:00Z");
    const tiedB = run("run-b", "reconnecting", "2026-08-19T11:00:00Z");
    useAgentStatusStore.setState({
      runs: { [old.agent_run_id]: old, [tiedA.agent_run_id]: tiedA, [tiedB.agent_run_id]: tiedB },
    });

    expect(selectLiveWorkItemRun(TASK_ID)?.agent_run_id).toBe("run-b");

    const selected = session(old.agent_run_id);
    useTerminalStore.setState({
      sessions: { [selected.sessionId]: selected },
      sessionByRun: { [old.agent_run_id]: selected.sessionId },
    });
    useClientStore.setState({ activeByTask: { [TASK_ID]: selected.sessionId } });
    expect(selectLiveWorkItemRun(TASK_ID)?.agent_run_id).toBe(old.agent_run_id);
  });

  it.each([
    "starting",
    "working",
    "needs_input",
    "permission_required",
    "turn_complete",
    "quiet",
    "reconnecting",
  ] as const)("selects a %s task run as live", (state) => {
    const live = run(`run-${state}`, state);
    useAgentStatusStore.setState({ runs: { [live.agent_run_id]: live } });
    expect(selectLiveWorkItemRun(TASK_ID)?.agent_run_id).toBe(live.agent_run_id);
  });

  it("keeps a stalled task run live", () => {
    const stalled = {
      ...run("run-stalled"),
      last_output_at: "2026-08-19T10:00:00Z",
    };
    useAgentStatusStore.setState({ runs: { [stalled.agent_run_id]: stalled } });
    expect(selectLiveWorkItemRun(TASK_ID)?.agent_run_id).toBe(stalled.agent_run_id);
  });

  it.each(["exited", "lost", "error"] as const)(
    "does not select %s history as live",
    (state) => {
      const ended = run(`run-${state}`, state);
      useAgentStatusStore.setState({ runs: { [ended.agent_run_id]: ended } });
      expect(selectLiveWorkItemRun(TASK_ID)).toBeNull();
    },
  );

  it.each([
    { scope: "plan", taskId: TASK_ID, agent: "codex" },
    { scope: "instant", taskId: TASK_ID, agent: "codex" },
    { scope: "shell", taskId: TASK_ID, agent: null },
    { scope: "task", taskId: null, agent: "codex" },
  ] as const)("excludes a $scope run from work-item activation", (facts) => {
    const other = {
      ...run(`run-${facts.scope}`),
      scope: facts.scope,
      task_id: facts.taskId,
      agent: facts.agent,
    };
    useAgentStatusStore.setState({ runs: { [other.agent_run_id]: other } });
    expect(selectLiveWorkItemRun(TASK_ID)).toBeNull();
  });

  it("reports missing terminal metadata without falling through to a launch", async () => {
    const live = run("run-before-metadata", "reconnecting");
    useAgentStatusStore.setState({ runs: { [live.agent_run_id]: live } });

    workspace(true);
    pressEnter();

    await waitFor(() => {
      expect(useClientStore.getState().toasts.at(-1)?.message).toContain(
        "persisted terminal metadata is not available yet",
      );
    });
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    expect(directLaunchApi.launchAgent).not.toHaveBeenCalled();
  });

  it.each([
    { sidebarVisible: true, layout: "full sidebar" },
    { sidebarVisible: false, layout: "Edit view" },
  ])("launches and attaches one default run from the $layout Stories list", async ({
    sidebarVisible,
  }) => {
    directLaunchApi.launchAgent.mockResolvedValue({
      target_id: TASK_ID,
      agent: "codex",
      agent_run_id: `run-default-${sidebarVisible}`,
    });
    workspace(sidebarVisible);

    pressEnter();

    await waitFor(() => {
      expect(directLaunchApi.launchAgent).toHaveBeenCalledExactlyOnceWith({
        issueId: TASK_ID,
      });
      expect(screen.getAllByRole("tab", { name: "codex terminal" }))
        .toHaveLength(1);
    });
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
    expect(useClientStore.getState().workspaces[TASK_ID]?.active).toBe("terminal");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    expect(useClientStore.getState().focusedPane).toBe("tasks");
  });

  it("coalesces repeated Enter presses through launch and initial attachment", async () => {
    let finishLaunch!: (value: {
      target_id: string;
      agent: string;
      agent_run_id: string;
    }) => void;
    directLaunchApi.launchAgent.mockReturnValue(new Promise((resolve) => {
      finishLaunch = resolve;
    }));
    workspace(true);

    pressEnter();
    pressEnter();
    expect(directLaunchApi.launchAgent).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishLaunch({
        target_id: TASK_ID,
        agent: "codex",
        agent_run_id: "run-pending",
      });
    });
    pressEnter();

    expect(directLaunchApi.launchAgent).toHaveBeenCalledTimes(1);
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(1);
    expect(screen.getAllByRole("tab", { name: "codex terminal" }))
      .toHaveLength(1);
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
  });

  it.each(["exited", "lost", "error"] as const)(
    "launches past %s run history",
    async (state) => {
      const ended = run(`run-${state}`, state);
      useAgentStatusStore.setState({ runs: { [ended.agent_run_id]: ended } });
      directLaunchApi.launchAgent.mockResolvedValue({
        target_id: TASK_ID,
        agent: "codex",
        agent_run_id: `run-after-${state}`,
      });
      workspace(true);

      pressEnter();

      await waitFor(() => {
        expect(directLaunchApi.launchAgent).toHaveBeenCalledExactlyOnceWith({
          issueId: TASK_ID,
        });
      });
    },
  );

  it("keeps the previous tab on refusal and permits a later retry", async () => {
    directLaunchApi.launchAgent
      .mockRejectedValueOnce({
        body: { detail: { error: "provider_not_activated" } },
      })
      .mockResolvedValueOnce({
        target_id: TASK_ID,
        agent: "codex",
        agent_run_id: "run-retry",
      });
    workspace(false);

    pressEnter();

    await waitFor(() => {
      expect(useClientStore.getState().toasts.at(-1)?.message).toContain(
        "Launch blocked: this launch configuration names a provider that is deactivated.",
      );
    });
    expect(useClientStore.getState().workspaces[TASK_ID]?.active).toBe("details");
    expect(Object.values(useTerminalStore.getState().sessions)).toHaveLength(0);
    expect(screen.queryByRole("tab", { name: "codex terminal" }))
      .not.toBeInTheDocument();

    pressEnter();

    await waitFor(() => {
      expect(directLaunchApi.launchAgent).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("tab", { name: "codex terminal" }))
        .toHaveAttribute("aria-selected", "true");
    });
    expect(terminalApi.createTerminalRun).not.toHaveBeenCalled();
  });
});
