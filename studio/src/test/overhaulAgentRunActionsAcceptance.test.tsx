import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("[overhaul-254] dispatches focus through workspace and terminal focus authorities", async () => {
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

    await expect(studioKeymapRegistry.dispatch(
      AGENT_RUN_ACTIONS.focusAgentRun,
      { runId: "run-1" },
    )).resolves.toBe(true);

    expect(document.activeElement).toBe(terminal);

    unregisterFocus();
    terminal.remove();
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
