/**
 * What a panel shell's ending does, and what it must leave alone (#670).
 *
 * Every ending here arrives the way a real one does: as pushed completion state
 * on the project status feed, which is also what backend reconciliation
 * publishes when it finds a session gone. Nothing is driven from a viewer
 * closing, because a viewer is a fact about a window and the panel must behave
 * the same under the native renderer and the browser fallback.
 *
 * The last case pins an absence. A shell run moves no agent activity count and
 * is no stop in the live-terminal cycle — today by explicit guard, previously
 * only because scope and task filters happened to miss it. It is asserted here
 * against runs deliberately shaped to slip through those filters, so the guard
 * is what is being tested rather than the coincidence it replaced.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import {
  selectModuleLifecycleCounts,
  selectScratchLifecycleChips,
  selectScratchRunIds,
  selectTaskLifecycleChips,
  selectTaskRunCount,
} from "../features/agents/status/selectors";
import { applyRunStatusFrame } from "../features/agents/status/stream/runStatusHolding";
import { applySnapshotFrame } from "../features/agents/status/stream/statusSnapshot";
import {
  statusRunHolding,
  terminalStatusFrame,
} from "../features/agents/status/testing/durableStatusFrames";
import type { RunRecord } from "../features/agents/status/types";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedModuleLinks } from "../features/module-links";
import { selectLiveTerminalStops } from "../features/studio/lib/liveTerminalCycle";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { TerminalPanel } from "../features/terminal-panel/TerminalPanel";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";

const runtime = vi.hoisted(() => ({ desktop: false, nativeAvailable: false }));

const shellApi = vi.hoisted(() => ({
  createModuleShell: vi.fn(),
  listModuleShells: vi.fn(),
}));

const terminalApi = vi.hoisted(() => ({ terminateTerminal: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ columns: 80, rows: 24 }),
  isTauri: () => runtime.desktop,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock(
  "../features/agents/terminal/internal/nativeGhosttyAvailability",
  () => ({ nativeGhosttyAvailable: async () => runtime.nativeAvailable }),
);

vi.mock("../features/terminal-panel/api/moduleShellApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../features/terminal-panel/api/moduleShellApi")
  >()),
  ...shellApi,
}));

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => ({
    term: { open: () => {}, focus: () => {}, cols: 80, rows: 24 },
    fit: { fit: () => {}, proposeDimensions: () => ({ cols: 80, rows: 24 }) },
    lastCols: 80,
    lastRows: 24,
    ws: null,
    agentRunId: null,
  }),
  ensureConnected: () => {},
  notifyForeground: () => {},
  notifyBackground: () => {},
  rememberTerminalGeometry: () => {},
  registerPoolDriver: () => () => {},
  releasePooledTransport: () => {},
  syncEntries: () => {},
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const AT = "2026-08-15T10:00:00.000Z";

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function renderPanel() {
  return render(
    <>
      <KeymapHarness />
      <TerminalPanel />
    </>,
  );
}

function pressTogglePanel(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "`", ctrlKey: true });
  });
}

function tabs(): HTMLElement[] {
  return screen.queryAllByTestId("terminal-panel-tab");
}

function tabRunIds(): (string | null)[] {
  return tabs().map((tab) => tab.getAttribute("data-run-id"));
}

function activeRunId(): string | null {
  return (
    tabs()
      .find((tab) => tab.getAttribute("data-active") === "true")
      ?.getAttribute("data-run-id") ?? null
  );
}

function click(element: Element): void {
  act(() => {
    fireEvent.click(element);
  });
}

/** The record the backend publishes when a shell run goes live. */
function shellRun(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: runId,
    project_id: "project-1",
    task_id: null,
    module_id: "module-1",
    agent: null,
    scope: "shell",
    started_at: AT,
    state: "starting",
    updated_at: AT,
    ...overrides,
  };
}

/** Announce a live shell run exactly as its launch does. */
function announceShell(runId: string): void {
  act(() => {
    const status = useAgentStatusStore.getState();
    applySnapshotFrame({
      __typename: "RunStatusSnapshot",
      project_id: "project-1",
      cursor: 1,
      at: AT,
      runs: [
        ...Object.values(status.runs).map(statusRunHolding),
        statusRunHolding(shellRun(runId)),
      ],
      automation_attempts: [],
    });
  });
}

/** Push the completion state reconciliation publishes for a dead session. */
function announceExit(runId: string, exitCode: number | null): void {
  act(() => {
    applyRunStatusFrame(terminalStatusFrame({
      projectId: "project-1",
      agentRunId: runId,
      state: "exited",
      at: "2026-08-15T10:05:00.000Z",
      exitCode,
    }));
  });
}

/** Adds one shell through the strip's own create action. */
async function addShell(runId: string): Promise<void> {
  shellApi.createModuleShell.mockResolvedValueOnce(runId);
  click(screen.getByTestId("terminal-panel-new-shell"));
  await waitFor(() => expect(activeRunId()).toBe(runId));
  announceShell(runId);
}

function resetStudioState(): void {
  useTerminalPanelStore.setState({ openModules: {}, focusSignal: 0 });
  useModuleShellStore.setState({ byModule: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  useAgentStatusStore.setState({
    projectId: "project-1",
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
}

describe("terminal panel shell exit acceptance", () => {
  beforeEach(() => {
    localStorage.setItem("ticketry:terminal-renderer", "xterm");
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell-1");
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    terminalApi.terminateTerminal.mockReset();
    terminalApi.terminateTerminal.mockResolvedValue({ ok: true });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    resetStudioState();
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({
      selectedModuleId: "module-1",
      sidebarVisible: false,
      editViewZone: "active-tab-body",
      editViewBodyEngaged: false,
      activeByTask: {},
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    seedModuleLinks([
      { id: "link-module-1", moduleId: "module-1", path: "/repo/module-1" },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-105] disposes the tab of a shell the person exited cleanly", async () => {
    // Under both renderers, because the ending is read from the run projection
    // and never from a viewer: which one is drawing cannot change what a shell
    // exiting means.
    for (const native of [false, true]) {
      runtime.desktop = native;
      runtime.nativeAvailable = native;
      resetStudioState();
      shellApi.createModuleShell.mockReset();
      shellApi.createModuleShell.mockResolvedValue("run-shell-1");

      const panel = renderPanel();
      pressTogglePanel();
      await waitFor(() => expect(tabs()).toHaveLength(1));
      announceShell("run-shell-1");
      await addShell("run-shell-2");
      expect(tabRunIds()).toEqual(["run-shell-1", "run-shell-2"]);

      // Typing `exit` in the first shell ends it with nothing left to read.
      announceExit("run-shell-1", 0);

      await waitFor(() => expect(tabs()).toHaveLength(1));
      expect(tabRunIds()).toEqual(["run-shell-2"]);
      // The tab goes without taking the other shell's terminal with it, and
      // without minting a replacement behind the person who exited.
      expect(activeRunId()).toBe("run-shell-2");
      expect(screen.getAllByTestId("terminal-host")).toHaveLength(1);
      expect(shellApi.createModuleShell).toHaveBeenCalledTimes(2);
      panel.unmount();
    }
  });

  it("[overhaul-106] keeps a failed shell with its exit code and restarts it in place", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    announceShell("run-shell-1");
    await addShell("run-shell-2");

    // The second shell dies badly while it is the one showing.
    announceExit("run-shell-2", 3);

    // Its tab stays exactly where it was, saying what happened, because it is
    // the only record of the failure the person has.
    await waitFor(() =>
      expect(screen.getByTestId("terminal-panel-dead-shell")).toBeTruthy(),
    );
    expect(tabRunIds()).toEqual(["run-shell-1", "run-shell-2"]);
    expect(activeRunId()).toBe("run-shell-2");
    expect(screen.getByText(/exit 3/)).toBeTruthy();
    expect(
      screen.getByTestId("terminal-panel-dead-shell").getAttribute("data-exit-code"),
    ).toBe("3");
    expect(screen.queryAllByTestId("terminal-host")).toHaveLength(0);

    // Restarting puts a brand new shell in that same slot. The dead run is
    // never revived: nothing re-attaches to it and it keeps no viewer.
    shellApi.createModuleShell.mockResolvedValueOnce("run-shell-3");
    click(screen.getByTestId("terminal-panel-restart-shell"));

    await waitFor(() => expect(tabRunIds()).toEqual(["run-shell-1", "run-shell-3"]));
    expect(activeRunId()).toBe("run-shell-3");
    expect(screen.queryByTestId("terminal-panel-dead-shell")).toBeNull();
    expect(screen.getAllByTestId("terminal-host")).toHaveLength(1);
    expect(useTerminalStore.getState().sessionByRun["run-shell-2"]).toBeUndefined();
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(3);
  });

  it("[overhaul-107] moves no agent activity count and is no stop in the live-terminal cycle", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));

    // A shell run shaped to slip past every filter that used to exclude it by
    // accident: a real task id, a lifecycle state a module badge counts, and a
    // session sitting in a task's own slot in the cycle.
    act(() => {
      applySnapshotFrame({
        __typename: "RunStatusSnapshot",
        project_id: "project-1",
        cursor: 2,
        at: AT,
        runs: [statusRunHolding(shellRun("run-shell-1", {
          task_id: "task-1",
          state: "working",
        })), statusRunHolding({
          ...shellRun("run-agent-1", { task_id: "task-1", state: "working" }),
          agent: "codex",
          scope: "task",
        })],
        automation_attempts: [],
      });
    });

    const status = useAgentStatusStore.getState();
    // The module badge, the work-item rollup and the subtree chicklets all
    // count the agent run and only the agent run.
    expect(selectModuleLifecycleCounts(status, "module-1").working).toBe(1);
    expect(selectTaskRunCount(status, "task-1")).toBe(1);
    expect(selectTaskLifecycleChips(status, "task-1")).toEqual([
      { state: "working", count: 1 },
    ]);
    // The module's scratch chicklets are plan/instant work; a shell is neither.
    expect(selectScratchLifecycleChips(status, "project-1", "module-1")).toEqual([]);
    expect(selectScratchRunIds(status, "project-1", "module-1")).toEqual([]);

    // The cycle walks the work-item tree's agent terminals. Even with the shell
    // session presented as if it belonged to the task, it is not one of them.
    const stops = selectLiveTerminalStops({
      moduleId: "module-1",
      taskRows: [],
      taskOrder: ["task-1"],
      agentStatus: useAgentStatusStore.getState(),
      sessions: {
        "session-shell": {
          sessionId: "session-shell",
          agentRunId: "run-shell-1",
          taskId: "task-1",
          moduleId: "module-1",
        },
        "session-agent": {
          sessionId: "session-agent",
          agentRunId: "run-agent-1",
          taskId: "task-1",
          moduleId: "module-1",
        },
      },
    });
    expect(stops.map((stop) => stop.agentRunId)).toEqual(["run-agent-1"]);
  });
});
