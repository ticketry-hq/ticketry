/**
 * The terminal panel as the edit view's fourth navigation zone (#669).
 *
 * What a person observes here is that `Shift+Tab` reaches the panel only while
 * it is on screen, that arriving in it is already typing in the shell, that the
 * chord they already use to stop typing does not take the panel away, and that
 * closing the panel hands the zone back instead of stranding the cycle on a
 * surface that is gone.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { TerminalPanel } from "../features/terminal-panel/TerminalPanel";
import { useModalStore } from "../app/modal/modalStore";
import { useClientStore } from "../state/clientStore";

const shellApi = vi.hoisted(() => ({
  createModuleShell: vi.fn(),
  listModuleShells: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ columns: 80, rows: 24 }),
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock(
  "../features/agents/terminal/internal/nativeGhosttyAvailability",
  () => ({ nativeGhosttyAvailable: async () => false }),
);

vi.mock(
  "../features/terminal-panel/api/moduleShellApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../features/terminal-panel/api/moduleShellApi")
    >()),
    ...shellApi,
  }),
);

// One fake pooled xterm per session, so "the keyboard landed in the shell" is
// something the test can see rather than infer.
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

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: (sessionId: string) => ({
    term: {
      open: () => {},
      focus: () => {
        pool.entryFor(sessionId).focusCalls += 1;
      },
      cols: 80,
      rows: 24,
    },
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

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(window, { key, ...init });
  });
}

function pressTogglePanel(): void {
  press("`", { ctrlKey: true });
}

function currentZone(): string {
  return useClientStore.getState().editViewZone;
}

/** Waits for the panel's shell to be attached, and reports its session. */
async function shellSessionId(): Promise<string> {
  return await waitFor(() => {
    const id = useTerminalStore.getState().sessionByRun["run-shell"];
    expect(id).toBeTruthy();
    return id;
  });
}

describe("terminal panel zone acceptance", () => {
  beforeEach(() => {
    pool.entries.clear();
    localStorage.clear();
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell");
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useTerminalPanelStore.setState({ openModules: {}, height: 280, focusSignal: 0 });
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
      modalStack: [],
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    seedConfig({
      profiles: [
        {
          name: "local",
          workspace_slug: "meml",
          agent_prompt: null,
          agent_prompts: {},
          module_links: [{ module_id: "module-1", path: "/repo/module-1" }],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-103] joins the zone cycle only while it is showing, and arriving is already typing", async () => {
    renderPanel();

    // Closed, the cycle is the three zones it has always been.
    press("Tab", { shiftKey: true });
    expect(currentZone()).toBe("stories");

    pressTogglePanel();
    const sessionId = await shellSessionId();
    act(() => {
      useClientStore.setState({
        editViewZone: "active-tab-body",
        editViewBodyEngaged: false,
      });
    });

    press("Tab", { shiftKey: true });
    expect(currentZone()).toBe("terminal-panel");
    // The panel holds nothing but a shell, so reaching it commits to typing in
    // that shell rather than stopping on a surface with no keys of its own.
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);
    await waitFor(() =>
      expect(pool.entryFor(sessionId).focusCalls).toBeGreaterThan(0),
    );

    // Ordinary navigation keys now belong to the shell.
    press("ArrowUp");
    expect(currentZone()).toBe("terminal-panel");

    // And the cycle carries on past the panel and wraps.
    act(() => {
      useClientStore.getState().setEditViewBodyEngaged(false);
    });
    press("Tab", { shiftKey: true });
    expect(currentZone()).toBe("stories");
  });

  it("[overhaul-104] leaves typing on the established chord without taking the panel away", async () => {
    renderPanel();
    pressTogglePanel();
    await shellSessionId();
    expect(currentZone()).toBe("terminal-panel");
    expect(useClientStore.getState().editViewBodyEngaged).toBe(true);

    press("Escape", { metaKey: true });
    expect(useClientStore.getState().editViewBodyEngaged).toBe(false);
    // Still on screen, still the current zone: stepping out of typing is not
    // discarding the layout.
    expect(screen.getByTestId("terminal-panel")).toBeTruthy();
    expect(currentZone()).toBe("terminal-panel");

    // Closing stays the toggle's job, and hands the zone back with it.
    pressTogglePanel();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(currentZone()).toBe("active-tab-body");
    press("Tab", { shiftKey: true });
    expect(currentZone()).toBe("stories");
  });
});
