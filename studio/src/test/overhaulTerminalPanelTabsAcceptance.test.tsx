/**
 * The terminal panel's module-owned tab set (#668).
 *
 * Everything asserted here is something a person can observe: several shells in
 * one module with one of them showing, a bound they can see themselves hit,
 * a module switch that swaps the strip and returns them to the shell they left
 * in front, a restart that finds the shells still running rather than starting
 * more, a close that really ends a shell, and background tabs that hold nothing.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import {
  dismissedRunsFor,
  scratchBucketId,
  useTerminalStore,
} from "../features/agents/terminal/internal/sessionStore";
import { useStudioStore } from "../features/projects/store";
import { seedConfig } from "../features/studio/stores/configStore";
import { ACTIVE_SHELL_KEY } from "../features/terminal-panel/activeShellMemory";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { MAX_MODULE_SHELLS } from "../features/terminal-panel/shellTabSet";
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

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

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

function activeRunId(): string | null {
  return (
    tabs()
      .find((tab) => tab.getAttribute("data-active") === "true")
      ?.getAttribute("data-run-id") ?? null
  );
}

function tabFor(runId: string): HTMLElement {
  const tab = tabs().find((entry) => entry.getAttribute("data-run-id") === runId);
  if (!tab) throw new Error(`no tab for ${runId}`);
  return tab;
}

function click(element: Element): void {
  act(() => {
    fireEvent.click(element);
  });
}

/** Adds one shell through the strip's own create action. */
async function addShell(runId: string): Promise<void> {
  shellApi.createModuleShell.mockResolvedValueOnce(runId);
  click(screen.getByTestId("terminal-panel-new-shell"));
  await waitFor(() => expect(activeRunId()).toBe(runId));
}

function resetStudioState(): void {
  useTerminalPanelStore.setState({ openModules: {}, focusSignal: 0 });
  useModuleShellStore.setState({ byModule: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
}

describe("terminal panel tab acceptance", () => {
  beforeEach(() => {
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell-1");
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    terminalApi.terminateTerminal.mockReset();
    terminalApi.terminateTerminal.mockResolvedValue({ ok: true });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    // Each case starts with nothing remembered about which shell was in front.
    localStorage.removeItem(ACTIVE_SHELL_KEY);
    resetStudioState();
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
          agent_prompt: null,
          agent_prompts: {},
          module_links: [
            { module_id: "module-1", path: "/repo/module-1" },
            { module_id: "module-2", path: "/repo/module-2" },
          ],
          recent_project_id: null,
        },
      ],
      recentProfileIndex: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[overhaul-96] holds several shells in one module and shows exactly one of them", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(activeRunId()).toBe("run-shell-1");

    await addShell("run-shell-2");
    expect(tabs()).toHaveLength(2);
    // Two durable shells, one terminal on screen: the new one takes the front.
    expect(screen.getAllByTestId("terminal-host")).toHaveLength(1);

    // Choosing the earlier tab presents that shell instead, and only that one.
    click(tabFor("run-shell-1").querySelector("[role='tab']")!);
    await waitFor(() => expect(activeRunId()).toBe("run-shell-1"));
    expect(screen.getAllByTestId("terminal-host")).toHaveLength(1);
    expect(useTerminalForegroundStore.getState().claims).toEqual({
      "run-shell-1": "panel",
    });
  });

  it("[overhaul-97] stops at the shell cap with the create action visibly refused", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));

    for (let index = 2; index <= MAX_MODULE_SHELLS; index += 1) {
      await addShell(`run-shell-${index}`);
    }
    expect(tabs()).toHaveLength(MAX_MODULE_SHELLS);

    // At the cap the control stays where it was and refuses, rather than
    // disappearing or quietly launching a fifth durable session.
    const create = screen.getByTestId("terminal-panel-new-shell") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    click(create);
    await act(async () => {});
    expect(tabs()).toHaveLength(MAX_MODULE_SHELLS);
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(MAX_MODULE_SHELLS);
  });

  it("[overhaul-98] swaps the strip on a module switch and returns to that module's own active tab", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    await addShell("run-shell-2");
    click(tabFor("run-shell-1").querySelector("[role='tab']")!);
    await waitFor(() => expect(activeRunId()).toBe("run-shell-1"));

    // A different module brings its own shells, and nothing of the first one's.
    // It also brings its own answer to whether the panel shows at all (#730),
    // so reaching its strip means opening the panel there.
    shellApi.createModuleShell.mockResolvedValueOnce("run-other-1");
    act(() => {
      useClientStore.setState({ selectedModuleId: "module-2" });
    });
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    pressTogglePanel();
    await waitFor(() => expect(activeRunId()).toBe("run-other-1"));
    expect(tabs()).toHaveLength(1);
    expect(shellApi.listModuleShells).toHaveBeenCalledWith("module-2");

    // Coming back restores the set and the tab that module last had in front.
    act(() => {
      useClientStore.setState({ selectedModuleId: "module-1" });
    });
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(activeRunId()).toBe("run-shell-1");
    // Returning re-uses the shells that are already running.
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(3);
    // A module never shown carries no shell of its own.
    expect(shellApi.createModuleShell).not.toHaveBeenCalledWith("module-3");
  });

  it("[overhaul-99] rediscovers the shells that survived a restart and restores the tab that was in front", async () => {
    // First run: two shells exist in this module, and the second is the one
    // the person leaves showing.
    const first = renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    await addShell("run-shell-2");

    // That choice is written out under its own per-module key, once the
    // debounce settles rather than on every tab click.
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(ACTIVE_SHELL_KEY) ?? "{}")["module-1"],
      ).toBe("run-shell-2"),
    );

    // Studio restarts (or the sidecar is rebuilt): nothing is held in memory,
    // but the durable sessions are still there and the backend still lists them.
    first.unmount();
    resetStudioState();
    shellApi.createModuleShell.mockReset();
    shellApi.listModuleShells.mockResolvedValue([
      { agent_run_id: "run-shell-1", module_id: "module-1", created_at: "1" },
      { agent_run_id: "run-shell-2", module_id: "module-1", created_at: "2" },
    ]);
    renderPanel();
    pressTogglePanel();

    await waitFor(() => expect(tabs()).toHaveLength(2));
    // The surviving shells come back in their creation order, with the shell
    // that was last in front — not merely the first one — showing again, and
    // no new session launched beside them.
    expect(tabs().map((tab) => tab.getAttribute("data-run-id"))).toEqual([
      "run-shell-1",
      "run-shell-2",
    ]);
    expect(activeRunId()).toBe("run-shell-2");
    expect(shellApi.createModuleShell).not.toHaveBeenCalled();
  });

  it("[overhaul-100] ends a closed shell for real and lands on a determinate remaining tab", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    await addShell("run-shell-2");
    await addShell("run-shell-3");

    // Closing the shell that is showing terminates it and hands the panel the
    // tab that slid into its place.
    click(tabFor("run-shell-3").querySelector("[role='tab']")!);
    click(tabFor("run-shell-2").querySelector("[role='tab']")!);
    await waitFor(() => expect(activeRunId()).toBe("run-shell-2"));
    click(closeAffordance(tabFor("run-shell-2")));
    await waitFor(() => expect(tabs()).toHaveLength(2));
    expect(terminalApi.terminateTerminal).toHaveBeenCalledWith("run-shell-2");
    expect(activeRunId()).toBe("run-shell-3");
    // The closed shell keeps no viewer behind it.
    expect(useTerminalStore.getState().sessionByRun["run-shell-2"]).toBeUndefined();

    // Closing a background tab leaves the visible shell where it is.
    click(closeAffordance(tabFor("run-shell-1")));
    await waitFor(() => expect(tabs()).toHaveLength(1));
    expect(activeRunId()).toBe("run-shell-3");

    // Closing the last one empties the strip and says so, rather than going
    // blank or quietly minting a replacement behind the person who closed it.
    click(closeAffordance(tabFor("run-shell-3")));
    await waitFor(() => expect(tabs()).toHaveLength(0));
    expect(screen.getByTestId("terminal-panel-no-shells")).toBeTruthy();
    expect(screen.queryAllByTestId("terminal-host")).toHaveLength(0);
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(3);
  });

  it("[overhaul-100b] leaves a closed shell out of the module's dismissal ledger", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));

    // An agent terminal dismissed in this module's scratch bucket is the thing
    // the ledger exists for: it must survive any number of shell closes (#686).
    const bucket = scratchBucketId("module-1");
    act(() => {
      const agentTab = useTerminalStore.getState().openSession({
        taskId: null,
        projectId: "project-1",
        moduleId: "module-1",
        agent: "claude",
        agentRunId: "run-agent-scratch",
        select: false,
      });
      useTerminalStore.getState().closeTab(agentTab);
    });
    expect(dismissedRunsFor(bucket).has("run-agent-scratch")).toBe(true);

    const shells = ["run-shell-2", "run-shell-3", "run-shell-4"];
    for (const runId of shells) {
      await addShell(runId);
      click(closeAffordance(tabFor(runId)));
      await waitFor(() =>
        expect(useTerminalStore.getState().sessionByRun[runId]).toBeUndefined(),
      );
    }

    // A shell close terminates the run outright and shells never appear in the
    // scratch listing, so there is nothing to dismiss — recording one would only
    // crowd the capped ledger until the real dismissal fell out of it.
    const ledger = dismissedRunsFor(bucket);
    expect(shells.filter((runId) => ledger.has(runId))).toEqual([]);
    expect(ledger.has("run-agent-scratch")).toBe(true);
  });

  it("[overhaul-101] gives a viewer only to the shell showing in an open panel", async () => {
    renderPanel();
    pressTogglePanel();
    await waitFor(() => expect(tabs()).toHaveLength(1));
    await addShell("run-shell-2");

    // Two live shells, one viewer: a background tab holds nothing.
    expect(screen.getAllByTestId("terminal-host")).toHaveLength(1);
    expect(useTerminalForegroundStore.getState().claims).toEqual({
      "run-shell-2": "panel",
    });

    // Switching tabs moves the single claim rather than adding one.
    click(tabFor("run-shell-1").querySelector("[role='tab']")!);
    await waitFor(() =>
      expect(useTerminalForegroundStore.getState().claims).toEqual({
        "run-shell-1": "panel",
      }),
    );

    // Closing the panel detaches every shell, and both remain running.
    pressTogglePanel();
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(screen.queryAllByTestId("terminal-host")).toHaveLength(0);
    expect(useTerminalForegroundStore.getState().claims).toEqual({});
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    // Reopening presents the same remembered shell without launching another.
    pressTogglePanel();
    await waitFor(() => expect(activeRunId()).toBe("run-shell-1"));
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(2);
  });
});

/** The close affordance inside one tab. */
function closeAffordance(tab: HTMLElement): Element {
  const close = tab.querySelector("[data-testid='terminal-panel-tab-close']");
  if (!close) throw new Error("tab has no close affordance");
  return close;
}
