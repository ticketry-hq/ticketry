/**
 * The bottom terminal panel's first end-to-end slice (#667).
 *
 * Everything asserted here is something a person can observe: a keystroke
 * reveals a shell, the same keystroke reverses it from inside an agent's
 * terminal, a module with no folder is told rather than silently placed
 * somewhere else, a closed panel costs nothing, and two terminals on screen
 * never compete for one set of keystrokes.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import {
  useTerminalStore,
  type SessionMeta,
} from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedModuleLinks } from "../features/module-links";
import { ModuleShellRefused } from "../features/terminal-panel/api/moduleShellApi";
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

vi.mock("../features/agents/terminal/ghostty-wasm/GhosttyWasmTerminal", () => ({
  GhosttyWasmTerminal: () => (
    <div
      className="bg-inherit"
      data-testid="ghostty-wasm-host"
      data-terminal-renderer="ghostty-wasm"
    />
  ),
}));

vi.mock("../features/terminal-panel/api/moduleShellApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../features/terminal-panel/api/moduleShellApi")
  >()),
  ...shellApi,
}));

// One fake pooled xterm per session, so "which terminal got the keystrokes"
// is directly observable rather than inferred.
const pool = vi.hoisted(() => {
  const entries = new Map<string, { focusCalls: number }>();
  return {
    entries,
    entryFor(sessionId: string) {
      const existing = entries.get(sessionId);
      if (existing) return existing;
      const created = { focusCalls: 0 };
      entries.set(sessionId, created);
      return created;
    },
  };
});

vi.mock("../features/agents/terminal/internal/entryPool", () => {
  const makeEntry = (sessionId: string) => {
    const record = pool.entryFor(sessionId);
    return {
      term: {
        open: () => {},
        focus: () => {
          record.focusCalls += 1;
        },
        cols: 80,
        rows: 24,
      },
      fit: { fit: () => {}, proposeDimensions: () => ({ cols: 80, rows: 24 }) },
      lastCols: 80,
      lastRows: 24,
      ws: null,
      agentRunId: null,
    };
  };
  return {
    getEntry: (sessionId: string) => makeEntry(sessionId),
    ensureConnected: () => {},
    notifyForeground: () => {},
    notifyBackground: () => {},
    rememberTerminalGeometry: () => {},
    registerPoolDriver: () => () => {},
    releasePooledTransport: () => {},
    syncEntries: () => {},
  };
});

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function agentSession(): SessionMeta {
  return {
    sessionId: "session-agent",
    taskId: "task-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status: "ready",
    transport: "ready",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: "run-agent",
  };
}

function pressTogglePanel(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "`", ctrlKey: true });
  });
}

async function shellSessionId(): Promise<string> {
  return await waitFor(() => {
    const id = useTerminalStore.getState().sessionByRun["run-shell"];
    expect(id).toBeTruthy();
    return id;
  });
}

describe("terminal panel acceptance", () => {
  beforeEach(() => {
    localStorage.setItem("ticketry:terminal-renderer", "xterm");
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    pool.entries.clear();
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell");
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useTerminalPanelStore.setState({ openModules: {}, focusSignal: 0 });
    useModuleShellStore.setState({ byModule: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
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

  it("[overhaul-144] opens a module shell on the toggle, focuses it, and closes again from anywhere", async () => {
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );

    expect(screen.queryByTestId("terminal-panel")).toBeNull();

    pressTogglePanel();
    expect(screen.getByTestId("terminal-panel")).toBeTruthy();
    const sessionId = await shellSessionId();
    await waitFor(() =>
      expect(pool.entryFor(sessionId).focusCalls).toBeGreaterThan(0),
    );
    expect(shellApi.createModuleShell).toHaveBeenCalledWith("module-1");
    // The shell hangs off the module and carries no provider: it is a shell
    // run, never an agent run wearing a substitute agent.
    const shell = useTerminalStore.getState().sessions[sessionId];
    expect(shell.agent).toBeNull();
    expect(shell.moduleId).toBe("module-1");
    expect(shell.isShell).toBe(true);

    // Closing does not depend on where focus sits.
    act(() => {
      useClientStore.setState({ editViewBodyEngaged: true });
    });
    pressTogglePanel();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
  });

  it("[overhaul-145] resolves the toggle while an agent terminal holds typing mode", async () => {
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );
    act(() => {
      useClientStore.setState({
        editViewZone: "active-tab-body",
        editViewBodyEngaged: true,
      });
    });

    // Typing mode hands the engaged terminal every ordinary navigation key…
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowUp" });
    });
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");

    // …but the panel toggle is a capture-context binding, so it still resolves.
    pressTogglePanel();
    expect(screen.getByTestId("terminal-panel")).toBeTruthy();
    await shellSessionId();
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    // Closing returns the keyboard to the agent terminal that was engaged
    // before the panel temporarily took typing focus.
    pressTogglePanel();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
  });

  it("[overhaul-146] offers the folder affordance instead of launching elsewhere", async () => {
    shellApi.createModuleShell.mockRejectedValueOnce(
      new ModuleShellRefused("module_folder_missing"),
    );
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );

    pressTogglePanel();
    const refusal = await screen.findByTestId("terminal-panel-folder-required");
    expect(refusal.getAttribute("data-refusal-reason")).toBe(
      "module_folder_missing",
    );
    // No shell exists anywhere: a refused launch leaves no viewer behind.
    expect(useTerminalStore.getState().sessionByRun["run-shell"]).toBeUndefined();
    expect(screen.queryByTestId("terminal-host")).toBeNull();
  });

  it("[overhaul-147] attaches nothing while the panel stays closed", async () => {
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );

    // Entering a module is not enough: only opening the panel may mint a shell.
    act(() => {
      useClientStore.setState({ selectedModuleId: "module-2" });
    });
    await act(async () => {});
    expect(shellApi.createModuleShell).not.toHaveBeenCalled();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(screen.queryByTestId("terminal-host")).toBeNull();
    expect(useTerminalStore.getState().sessions).toEqual({});

    pressTogglePanel();
    await shellSessionId();
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
  });

  it("[overhaul-148] keeps an agent terminal and the panel shell visible without sharing keystrokes", async () => {
    useTerminalStore.setState({
      sessions: { "session-agent": agentSession() },
      sessionByRun: { "run-agent": "session-agent" },
    });
    render(
      <>
        <KeymapHarness />
        <Terminal sessionId="session-agent" owner="studio" focusSignal={0} active />
        <TerminalPanel />
      </>,
    );

    pressTogglePanel();
    const shellId = await shellSessionId();
    await waitFor(() => expect(screen.getAllByTestId("terminal-host")).toHaveLength(2));

    // Both terminals are on screen; only the one the toggle chose was focused.
    await waitFor(() =>
      expect(pool.entryFor(shellId).focusCalls).toBeGreaterThan(0),
    );
    expect(pool.entryFor("session-agent").focusCalls).toBe(0);
    // Claims are keyed by run, so the two surfaces cannot contest each other.
    expect(useTerminalForegroundStore.getState().claims).toEqual({
      "run-shell": "panel",
    });
  });

  it("[overhaul-149] uses Ghostty WASM in browser and desktop builds", async () => {
    window.history.replaceState({}, "", "/");
    localStorage.removeItem("ticketry:terminal-renderer");
    const browser = render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );
    pressTogglePanel();
    await shellSessionId();
    await waitFor(() => expect(screen.getByTestId("ghostty-wasm-host")).toBeTruthy());
    expect(screen.queryByTestId("native-terminal-host")).toBeNull();
    browser.unmount();

    runtime.desktop = true;
    runtime.nativeAvailable = true;
    useTerminalPanelStore.setState({ openModules: {}, focusSignal: 0 });
    useModuleShellStore.setState({ byModule: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });

    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );
    pressTogglePanel();
    await shellSessionId();
    await waitFor(() => expect(screen.getByTestId("ghostty-wasm-host")).toBeTruthy());
    expect(screen.queryByTestId("native-terminal-host")).toBeNull();

    const { readFile } = await import("node:fs/promises");
    const tauriConfig = JSON.parse(
      await readFile(`${process.cwd()}/src-tauri/tauri.conf.json`, "utf8"),
    );
    expect(tauriConfig.app.security.csp["script-src"]).toContain("'wasm-unsafe-eval'");
  });
});
