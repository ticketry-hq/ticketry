import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_RUN_ACTIONS,
  studioKeymapRegistry,
} from "../app/navigation/keymapRegistry";
import { createLaunchkeyController } from "../features/launchkey";
import {
  agentRun,
  DISCOVERY_INTERVAL_MS,
  LAUNCHKEY_MINI_MK3_PORTS,
  MemoryMidiRuntime,
  NO_PORTS,
  settleInput,
} from "../features/launchkey/launchkeyController.testFixtures";
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

const launchkeyActions: LaunchkeyRuntime = {
  midi: () => null,
  toggleHandyTranscription: vi.fn(async () => {}),
  submitTerminal: vi.fn(async () => {}),
};

function installRunSession(runId: string): void {
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
        agentRunId: runId,
      },
    },
    sessionByRun: { [runId]: "viewer-1" },
  });
}

describe("overhaul acceptance - Launchkey agent controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    initializeStudioRuntime({
      ...createBrowserRuntime({ environment: {} }),
      launchkey: launchkeyActions,
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
  });

  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("[overhaul-255] excludes historical failures, lights live runs, and acknowledges newly failed pads", async () => {
    const shell = agentRun({
      agent_run_id: "shell-run",
      agent: null,
      scope: "shell",
      started_at: "2026-09-04T07:59:59.000Z",
    });
    const failed = agentRun({ agent_run_id: "failed-run", state: "working" });
    const working = Array.from({ length: 15 }, (_, index) => agentRun({
      agent_run_id: `working-${index + 1}`,
      started_at: `2026-09-04T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
    }));
    const overflow = agentRun({
      agent_run_id: "overflow-run",
      state: "needs_input",
      started_at: "2026-09-04T08:00:16.000Z",
    });
    const history = Array.from({ length: 20 }, (_, index) => agentRun({
      agent_run_id: `historical-${index}`, state: index % 2 ? "lost" : "error",
      started_at: "2026-08-01T00:00:00.000Z",
    }));
    const instant = agentRun({
      agent_run_id: "instant-chat", scope: "instant", state: "permission_required",
      started_at: "2026-08-01T00:00:00.000Z",
    });
    const runs = [...history, shell, instant, failed, ...working, overflow];
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: Object.fromEntries(runs.map((run) => [run.agent_run_id, run])),
      automationAttempts: {},
      automationByTask: {},
    });
    installRunSession("failed-run");

    const terminal = document.createElement("button");
    document.body.appendChild(terminal);
    const unregisterFocus = registerTerminalFocus(
      "viewer-1",
      () => terminal.focus(),
    );
    const midi = new MemoryMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();
    const transport = midi.connectedTransports[0];
    useAgentStatusStore.setState({ runs: Object.fromEntries(
      runs.map((run) => [run.agent_run_id, run.agent_run_id === "failed-run" ? { ...run, state: "error" } : run]),
    ) });
    expect(transport?.sent).toContainEqual({
      port: "daw",
      data: [0x90, 96, 5],
    });
    expect(transport?.sent).toContainEqual({
      port: "daw",
      data: [0x90, 97, 3],
    });
    expect(transport?.sent).not.toContainEqual({
      port: "daw",
      data: [0x92, 96, 5],
    });

    transport?.sent.splice(0);
    transport?.receive("daw", [0x90, 96, 127]);
    await settleInput();

    await vi.waitFor(() => expect(document.activeElement).toBe(terminal));
    // Acknowledgement frees the failed pad; live runs and overflow move up.
    expect(transport?.sent).toContainEqual({ port: "daw", data: [0x90, 96, 3] });
    expect(transport?.sent).toContainEqual({ port: "daw", data: [0x92, 119, 13] });
    expect(transport?.sent).not.toContainEqual({ port: "daw", data: [0x92, 96, 5] });

    useAgentStatusStore.setState({ runs: Object.fromEntries(runs.map((run) => [
      run.agent_run_id,
      run.agent_run_id === "working-1" ? { ...run, state: "turn_complete" }
        : run.agent_run_id === "working-2" ? { ...run, effective_state: "stalled" }
        : run.agent_run_id === "working-3" ? { ...run, state: "permission_required" }
        : run.agent_run_id === "failed-run" ? { ...run, state: "error" }
        : run,
    ])) });
    expect(transport?.sent).toContainEqual({ port: "daw", data: [0x90, 96, 21] });
    expect(transport?.sent).toContainEqual({ port: "daw", data: [0x90, 97, 13] });
    expect(transport?.sent).toContainEqual({ port: "daw", data: [0x91, 98, 3] });

    useAgentStatusStore.setState({
      projectId: "project-2",
      runs: {
        "project-2-run": agentRun({
          agent_run_id: "project-2-run",
          project_id: "project-2",
          state: "permission_required",
        }),
      },
      automationAttempts: {},
      automationByTask: {},
    });

    expect(transport?.sent).toContainEqual({
      port: "daw",
      data: [0x91, 96, 3],
    });
    expect(transport?.sent.at(-1)).toEqual({
      port: "daw",
      data: [0x92, 119, 0],
    });

    unregisterFocus();
    terminal.remove();
    await controller.stop();
  });

  it("[overhaul-256] toggles voice, submits the selected run, and restores controls after reconnect", async () => {
    const run = agentRun();
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: { [run.agent_run_id]: run },
      automationAttempts: {},
      automationByTask: {},
    });
    installRunSession(run.agent_run_id);
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

    const midi = new MemoryMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });
    await controller.start();
    const firstTransport = midi.connectedTransports[0];
    firstTransport?.sent.splice(0);

    firstTransport?.receive("daw", [0xbf, 117, 127]);
    firstTransport?.receive("daw", [0xbf, 115, 127]);
    await vi.waitFor(() => {
      expect(launchkeyActions.toggleHandyTranscription).toHaveBeenCalledOnce();
      expect(launchkeyActions.submitTerminal).toHaveBeenCalledWith("viewer-1");
    });
    expect(firstTransport?.sent).toEqual([
      { port: "daw", data: [0xbf, 117, 127] },
    ]);

    midi.availablePorts = NO_PORTS;
    firstTransport?.loseConnection();
    await settleInput();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);

    const reconnected = midi.connectedTransports[1];
    expect(reconnected?.sent).toContainEqual({
      port: "daw",
      data: [0x9f, 0x0c, 0x7f],
    });
    expect(reconnected?.sent).toContainEqual({
      port: "daw",
      data: [0xbf, 117, 127],
    });

    firstTransport?.receive("daw", [0xbf, 117, 127]);
    await settleInput();
    expect(launchkeyActions.toggleHandyTranscription).toHaveBeenCalledOnce();

    reconnected?.receive("daw", [0xbf, 117, 127]);
    await vi.waitFor(() => {
      expect(launchkeyActions.toggleHandyTranscription).toHaveBeenCalledTimes(2);
    });
    expect(reconnected?.sent.at(-1)).toEqual({
      port: "daw",
      data: [0xbf, 117, 0],
    });

    await controller.stop();
  });

  it("[overhaul-257] leaves browser MIDI inert and preserves normal focus with no Launchkey", async () => {
    const requestMIDIAccess = vi.fn();
    vi.stubGlobal("navigator", { requestMIDIAccess });
    const browserRuntime = createBrowserRuntime({ environment: {} });

    expect(browserRuntime.launchkey.midi()).toBeNull();
    expect(requestMIDIAccess).not.toHaveBeenCalled();

    initializeStudioRuntime({
      ...browserRuntime,
      launchkey: launchkeyActions,
    });
    const run = agentRun();
    useAgentStatusStore.setState({
      projectId: "project-1",
      runs: { [run.agent_run_id]: run },
      automationAttempts: {},
      automationByTask: {},
    });
    installRunSession(run.agent_run_id);
    const terminal = document.createElement("button");
    document.body.appendChild(terminal);
    const unregisterFocus = registerTerminalFocus(
      "viewer-1",
      () => terminal.focus(),
    );
    const midi = new MemoryMidiRuntime();
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();
    expect(midi.listPortsCalls).toBe(1);
    expect(midi.connectedTransports).toEqual([]);

    await expect(studioKeymapRegistry.dispatch(
      AGENT_RUN_ACTIONS.focusAgentRun,
      { runId: run.agent_run_id },
    )).resolves.toBe(true);
    expect(document.activeElement).toBe(terminal);
    expect(midi.connectedTransports).toEqual([]);

    unregisterFocus();
    terminal.remove();
    await controller.stop();
  });
});
