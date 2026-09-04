/**
 * The terminal panel as window furniture: its height, its size mode and
 * whether it is showing (#669, #725, #726).
 *
 * What a person observes here is that dragging the panel's top edge trades
 * terminal height against the work item above it, that the drag cannot produce
 * a panel too short to hold a prompt or tall enough to swallow the window, and
 * that coming back to Studio returns the panel exactly as it was left. The
 * store's own fields are never inspected — only the persisted record a restart
 * actually reads, and the height the panel actually renders at.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioFooter } from "../app/shell/StudioFooter";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useStudioStore } from "../features/projects/store";
import { seedModuleLinks } from "../features/module-links";
import { useModuleShellStore } from "../features/terminal-panel/moduleShellStore";
import { useTerminalPanelStore } from "../features/terminal-panel/panelStore";
import { TerminalPanel } from "../features/terminal-panel/TerminalPanel";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { TERMINAL_PANEL_KEY } from "../state/persistence";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

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

vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

// A pooled xterm stub, so opening the panel really mounts a viewer without
// pulling a canvas renderer into the case.
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

vi.mock(
  "../features/terminal-panel/api/moduleShellApi",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../features/terminal-panel/api/moduleShellApi")
    >()),
    ...shellApi,
  }),
);

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function KeymapHarness() {
  useGlobalKeymap();
  return null;
}

function pressTogglePanel(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "`", ctrlKey: true });
  });
}

/** Drags the panel's top edge by `distance` pixels; negative is upward. */
function dragGrip(distance: number): void {
  const grip = screen.getByTestId("terminal-panel-resize-grip");
  act(() => {
    fireEvent.mouseDown(grip, { clientY: 600 });
    fireEvent.mouseMove(window, { clientY: 600 + distance });
    fireEvent.mouseUp(window, { clientY: 600 + distance });
  });
}

function click(element: Element): void {
  act(() => {
    fireEvent.click(element);
  });
}

/** The footer's always-available terminal control. */
function footerToggle(): HTMLElement {
  return screen.getByTestId("footer-terminal-toggle");
}

function activeShellTabRunId(): string | null {
  return (
    screen
      .queryAllByTestId("terminal-panel-tab")
      .find((tab) => tab.getAttribute("data-active") === "true")
      ?.getAttribute("data-run-id") ?? null
  );
}

function panelHeight(): number {
  return Number.parseInt(
    screen.getByTestId("terminal-panel").style.height,
    10,
  );
}

function settlePersistence(): void {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

function persistedFurniture(): {
  open?: boolean;
  height?: number;
  maximized?: boolean;
} | null {
  const raw = localStorage.getItem(TERMINAL_PANEL_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, never>);
}

/** The bound the geometry policy allows for the window this case runs in. */
function currentMaximum(): number {
  return Math.round(window.innerHeight * 0.8);
}

/** Resizes the window the way a person dragging the Studio frame would. */
function resizeViewport(innerHeight: number): void {
  act(() => {
    window.innerHeight = innerHeight;
    fireEvent(window, new Event("resize"));
  });
}

/**
 * The native commands that would mean a lifecycle change rather than a resize.
 * Sizing the panel must move none of them: it is not an attach, a detach, a
 * hide, a show or terminal input.
 */
const NATIVE_LIFECYCLE_COMMANDS = [
  "native_terminal_attach",
  "native_terminal_detach",
  "native_terminal_hide",
  "native_terminal_show",
  "viewer_input",
];

function nativeLifecycleCommandCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [command] of vi.mocked(invoke).mock.calls as [string][]) {
    if (!NATIVE_LIFECYCLE_COMMANDS.includes(command)) continue;
    counts[command] = (counts[command] ?? 0) + 1;
  }
  return counts;
}

function maximizeButton(): HTMLElement {
  return screen.getByTestId("terminal-panel-maximize");
}

/**
 * The native path only presents against a host with a real frame and a viewer
 * lease, neither of which a headless document produces on its own. Both desktop
 * legs below observe the native presentation boundary through this same setup,
 * so a viewer that never attached cannot stand in for one that did. Returns the
 * frame spy's restore, which the case calls once it is done with the desktop
 * pass.
 */
function presentNativeViewer(): () => void {
  vi.mocked(invoke).mockImplementation((command: string) =>
    command.startsWith("native_terminal_")
      ? Promise.resolve({
          handle: "native-1",
          runId: "run-shell-1",
          columns: 80,
          rows: 24,
        })
      : Promise.resolve({ columns: 80, rows: 24 }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  const frame = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
  return () => frame.mockRestore();
}

/** Nudges the panel one keyboard step from the resize separator. */
function nudgeGrip(key: "ArrowUp" | "ArrowDown"): void {
  act(() => {
    fireEvent.keyDown(screen.getByTestId("terminal-panel-resize-grip"), { key });
  });
}

describe("terminal panel furniture acceptance", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    localStorage.clear();
    installDesktopGraphQlRuntime();
    vi.useFakeTimers();
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    terminalApi.terminateTerminal.mockReset();
    terminalApi.terminateTerminal.mockResolvedValue({ ok: true });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    shellApi.createModuleShell.mockReset();
    // A launch that never settles keeps this case about the panel's geometry:
    // no terminal mounts, so nothing but the panel itself can move its height.
    shellApi.createModuleShell.mockReturnValue(new Promise(() => {}));
    shellApi.listModuleShells.mockReset();
    shellApi.listModuleShells.mockResolvedValue([]);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    useTerminalPanelStore.setState({
      openModules: {},
      height: 280,
      maximized: false,
      focusSignal: 0,
    });
    useModuleShellStore.setState({ byModule: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({
      selectedModuleId: "module-1",
      sidebarVisible: false,
      editViewZone: "active-tab-body",
      editViewBodyEngaged: false,
    });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    seedModuleLinks([
      { id: "link-module-1", moduleId: "module-1", path: "/repo/module-1" },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("[overhaul-102] resizes the panel within its bounds and returns open at that height after a restart", async () => {
    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
      </>,
    );

    pressTogglePanel();
    expect(panelHeight()).toBe(280);

    // Dragging the top edge upward grows the panel by the distance travelled.
    dragGrip(-100);
    expect(panelHeight()).toBe(380);

    // The write is debounced like the pane layout: the drag itself persists
    // nothing, and one record lands once it settles. Height is all the window
    // keeps — whether the panel shows belongs to the module (#730).
    expect(persistedFurniture()).toBeNull();
    settlePersistence();
    expect(persistedFurniture()).toMatchObject({ height: 380 });
    expect(persistedFurniture()).not.toHaveProperty("open");

    // Neither end of a drag can produce a panel nobody can use: too short to
    // hold a prompt line, or tall enough to swallow the work item above it.
    dragGrip(400);
    expect(panelHeight()).toBe(120);
    dragGrip(-5000);
    expect(panelHeight()).toBeLessThanOrEqual(
      Math.round(window.innerHeight * 0.8),
    );

    dragGrip(0);
    const settled = panelHeight();
    settlePersistence();
    expect(persistedFurniture()).toMatchObject({ height: settled });

    // A restart reads that record back: the panel returns at the height it was
    // left at, in the module it was left open in, before anyone touches a key.
    vi.resetModules();
    const restarted = await import("../features/terminal-panel/panelStore");
    expect(restarted.useTerminalPanelStore.getState().height).toBe(settled);
    expect(restarted.isTerminalPanelOpenIn("module-1")).toBe(true);

    // Closing the panel is the module's business, not the window's: the height
    // the person dragged to survives it untouched.
    pressTogglePanel();
    settlePersistence();
    expect(persistedFurniture()).toMatchObject({ height: settled });
    expect(persistedFurniture()).not.toHaveProperty("open");
  });

  it("[overhaul-119] opens and minimizes the panel by pointer without disturbing the shell underneath", async () => {
    // This case watches a shell come up and go away with the panel, so it runs
    // on real time rather than the persistence clock the drag case needs.
    vi.useRealTimers();
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell-1");

    // The panel opens onto the selected module, so before one resolves there is
    // nothing for the control to open. It says so and refuses the click rather
    // than sitting there enabled and doing nothing (#739).
    act(() => {
      useClientStore.setState({ selectedModuleId: null });
    });
    const noModule = render(<StudioFooter />);
    expect(footerToggle().getAttribute("title")).toBe(
      "Select a module to open a terminal panel",
    );
    expect(footerToggle().getAttribute("aria-label")).toBe(
      "Select a module to open a terminal panel",
    );
    expect((footerToggle() as HTMLButtonElement).disabled).toBe(true);
    click(footerToggle());
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    expect(shellApi.createModuleShell).not.toHaveBeenCalled();
    noModule.unmount();
    act(() => {
      useClientStore.setState({ selectedModuleId: "module-1" });
    });

    const browser = render(
      <>
        <KeymapHarness />
        <TerminalPanel />
        <StudioFooter />
      </>,
    );

    // A hidden panel has no furniture of its own, so the footer is the way in —
    // and it says the action it performs, not the surface it points at.
    expect(screen.queryByTestId("terminal-panel")).toBeNull();
    expect(footerToggle().getAttribute("aria-label")).toBe("Open terminal panel");
    expect(footerToggle().getAttribute("title")).toBe("Open terminal panel");

    click(footerToggle());
    await waitFor(() => expect(screen.getByTestId("terminal-host")).toBeTruthy());
    const shellSession = useTerminalStore.getState().sessionByRun["run-shell-1"];
    expect(shellSession).toBeTruthy();
    // Showing the panel is a navigation zone change, exactly as the shortcut
    // does it: the footer did not invent its own open.
    expect(useClientStore.getState().editViewZone).toBe("terminal-panel");
    expect(footerToggle().getAttribute("aria-label")).toBe(
      "Minimize terminal panel",
    );

    // The panel's own minimize control is a real named button that sits beside
    // the shell tabs rather than inside their list.
    const minimize = screen.getByTestId("terminal-panel-minimize");
    expect(minimize.tagName).toBe("BUTTON");
    expect(minimize.getAttribute("aria-label")).toBe("Minimize terminal panel");
    expect(minimize.getAttribute("title")).toBe("Minimize terminal panel");
    expect(
      within(screen.getByTestId("terminal-panel-tabs")).queryByLabelText(
        "Minimize terminal panel",
      ),
    ).toBeNull();

    // Minimising hides the panel and unmounts its viewer. The shell itself is
    // untouched: nothing terminated it and nothing started a replacement.
    click(minimize);
    await waitFor(() => expect(screen.queryByTestId("terminal-panel")).toBeNull());
    expect(screen.queryByTestId("terminal-host")).toBeNull();
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
    expect(useClientStore.getState().editViewZone).toBe("active-tab-body");
    expect(footerToggle().getAttribute("aria-label")).toBe("Open terminal panel");

    // Reopening returns to the same shell, in the same tab, with no second
    // durable run behind it.
    click(footerToggle());
    await waitFor(() => expect(screen.getByTestId("terminal-host")).toBeTruthy());
    expect(useTerminalStore.getState().sessionByRun["run-shell-1"]).toBe(
      shellSession,
    );
    expect(activeShellTabRunId()).toBe("run-shell-1");
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    // The same controls drive the desktop build's native viewer, so the
    // presentation boundary is where minimising is observed, not what it means.
    browser.unmount();
    runtime.desktop = true;
    runtime.nativeAvailable = true;
    shellApi.createModuleShell.mockClear();
    useTerminalPanelStore.setState({ openModules: {}, focusSignal: 0 });
    useModuleShellStore.setState({ byModule: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    const restoreFrame = presentNativeViewer();

    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
        <StudioFooter />
      </>,
    );

    // On the desktop build the same pointer controls drive the native viewer:
    // the panel furniture is not a browser-only interface. The viewer really
    // attaches before minimising, so what disappears below is a presented
    // viewer rather than an empty host div.
    click(footerToggle());
    const nativeHost = await screen.findByTestId("native-terminal-host");
    expect(nativeHost.getAttribute("data-terminal-renderer")).toBe("libghostty");
    await waitFor(() =>
      expect(nativeLifecycleCommandCounts().native_terminal_attach).toBe(1),
    );

    click(screen.getByTestId("terminal-panel-minimize"));
    await waitFor(() =>
      expect(screen.queryByTestId("native-terminal-host")).toBeNull(),
    );
    // Hiding presents no viewer at all — and ends no run to achieve it.
    expect(screen.queryByTestId("terminal-host")).toBeNull();
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    click(footerToggle());
    await screen.findByTestId("native-terminal-host");
    await waitFor(() =>
      expect(nativeLifecycleCommandCounts().native_terminal_attach).toBe(2),
    );
    expect(activeShellTabRunId()).toBe("run-shell-1");
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
    restoreFrame();
  });

  it("[overhaul-121] maximizes to the current bound, restores the exact ordinary height, and keeps that size mode across hiding and restarts", async () => {
    // The shell really comes up here, because part of what maximizing must not
    // do is disturb the terminal it makes taller.
    vi.useRealTimers();
    shellApi.createModuleShell.mockReset();
    shellApi.createModuleShell.mockResolvedValue("run-shell-1");
    const originalViewport = window.innerHeight;

    const browser = render(
      <>
        <KeymapHarness />
        <TerminalPanel />
        <StudioFooter />
      </>,
    );

    click(footerToggle());
    const host = await screen.findByTestId("terminal-host");
    const shellSession = useTerminalStore.getState().sessionByRun["run-shell-1"];

    // The control is a real named button that says the action it performs, and
    // it sits beside the shell tabs rather than inside their list.
    expect(maximizeButton().tagName).toBe("BUTTON");
    expect(maximizeButton().getAttribute("aria-label")).toBe(
      "Maximize terminal panel",
    );
    expect(maximizeButton().getAttribute("title")).toBe(
      "Maximize terminal panel",
    );
    expect(
      within(screen.getByTestId("terminal-panel-tabs")).queryByLabelText(
        "Maximize terminal panel",
      ),
    ).toBeNull();

    // An ordinary height the person chose by dragging.
    dragGrip(-100);
    expect(panelHeight()).toBe(380);

    // Maximizing reaches the geometry policy's current upper bound — the panel
    // grows as far as it is allowed to and no further — and the same control
    // now offers the way back.
    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    expect(maximizeButton().getAttribute("aria-label")).toBe(
      "Restore terminal panel size",
    );
    expect(maximizeButton().getAttribute("title")).toBe(
      "Restore terminal panel size",
    );

    // The terminal underneath was resized in place: the same mounted viewer,
    // showing the same durable run, with nothing attached, started or ended to
    // achieve a layout change.
    expect(screen.getByTestId("terminal-host")).toBe(host);
    expect(useTerminalStore.getState().sessionByRun["run-shell-1"]).toBe(
      shellSession,
    );
    expect(activeShellTabRunId()).toBe("run-shell-1");
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    // Restoring returns to the exact height that was left behind, and repeated
    // cycles neither drift nor accumulate.
    click(maximizeButton());
    expect(panelHeight()).toBe(380);
    click(maximizeButton());
    click(maximizeButton());
    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    click(maximizeButton());
    expect(panelHeight()).toBe(380);

    // One debounced furniture record carries the mode and the ordinary height,
    // which is the single height restoring returns to.
    click(maximizeButton());
    await waitFor(() =>
      expect(persistedFurniture()).toEqual({
        height: 380,
        maximized: true,
      }),
    );

    // Hiding the panel and bringing it back is not a size decision: it returns
    // maximized, still holding the ordinary height to restore to.
    click(screen.getByTestId("terminal-panel-minimize"));
    await waitFor(() => expect(screen.queryByTestId("terminal-panel")).toBeNull());
    click(footerToggle());
    await screen.findByTestId("terminal-host");
    expect(panelHeight()).toBe(currentMaximum());
    expect(maximizeButton().getAttribute("aria-label")).toBe(
      "Restore terminal panel size",
    );
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);

    // A smaller window recomputes what maximized means rather than writing the
    // window's own measurement over the person's ordinary preference.
    resizeViewport(500);
    expect(panelHeight()).toBe(currentMaximum());
    expect(persistedFurniture()).toEqual({
      height: 380,
      maximized: true,
    });

    // A window with no room for a maximized panel falls back to the smallest
    // usable one rather than the absolute cap, so the tab strip, the footer and
    // the work item above cannot be pushed out of a window this short (#737).
    resizeViewport(140);
    expect(panelHeight()).toBe(120);
    expect(panelHeight()).toBeLessThan(window.innerHeight);
    expect(persistedFurniture()).toEqual({
      height: 380,
      maximized: true,
    });

    resizeViewport(originalViewport);
    expect(panelHeight()).toBe(currentMaximum());
    click(maximizeButton());
    expect(panelHeight()).toBe(380);

    // Dragging a maximized panel is direct manipulation, so it leaves maximized
    // mode and the height it lands on becomes the new ordinary one.
    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    dragGrip(114);
    expect(panelHeight()).toBe(currentMaximum() - 114);
    expect(maximizeButton().getAttribute("aria-label")).toBe(
      "Maximize terminal panel",
    );
    const draggedHeight = panelHeight();
    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    click(maximizeButton());
    expect(panelHeight()).toBe(draggedHeight);

    // The separator's keyboard nudge does the same, so height is not a
    // pointer-only setting once the panel has been maximized.
    click(maximizeButton());
    nudgeGrip("ArrowDown");
    expect(panelHeight()).toBe(currentMaximum() - 24);
    const nudgedHeight = panelHeight();
    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    click(maximizeButton());
    expect(panelHeight()).toBe(nudgedHeight);

    // A restart reads the record back: the panel returns maximized, in the
    // module it was left open in, still able to restore the ordinary height.
    click(maximizeButton());
    await waitFor(() =>
      expect(persistedFurniture()).toEqual({
        height: nudgedHeight,
        maximized: true,
      }),
    );
    vi.resetModules();
    const restarted = await import("../features/terminal-panel/panelStore");
    expect(restarted.useTerminalPanelStore.getState().maximized).toBe(true);
    expect(restarted.useTerminalPanelStore.getState().height).toBe(
      nudgedHeight,
    );
    expect(restarted.isTerminalPanelOpenIn("module-1")).toBe(true);

    // A record written before this feature existed knows only a height: it
    // comes back as an ordinary panel at that height, as does a corrupt one at
    // the default. Neither leaves anybody stuck in a mode they never chose.
    localStorage.setItem(TERMINAL_PANEL_KEY, JSON.stringify({ height: 300 }));
    vi.resetModules();
    const legacy = await import("../features/terminal-panel/panelStore");
    expect(legacy.useTerminalPanelStore.getState().maximized).toBe(false);
    expect(legacy.useTerminalPanelStore.getState().height).toBe(300);

    localStorage.setItem(TERMINAL_PANEL_KEY, "{ not a record");
    vi.resetModules();
    const corrupt = await import("../features/terminal-panel/panelStore");
    expect(corrupt.useTerminalPanelStore.getState().maximized).toBe(false);
    expect(corrupt.useTerminalPanelStore.getState().height).toBe(280);

    // The desktop build's native viewer is resized in place by the same
    // control: no second attach, no detach, no new run, no terminal input.
    browser.unmount();
    runtime.desktop = true;
    runtime.nativeAvailable = true;
    shellApi.createModuleShell.mockClear();
    useTerminalPanelStore.setState({
      openModules: {},
      height: 280,
      maximized: false,
      focusSignal: 0,
    });
    useModuleShellStore.setState({ byModule: {} });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    const restoreFrame = presentNativeViewer();

    render(
      <>
        <KeymapHarness />
        <TerminalPanel />
        <StudioFooter />
      </>,
    );

    click(footerToggle());
    const nativeHost = await screen.findByTestId("native-terminal-host");
    expect(nativeHost.getAttribute("data-terminal-renderer")).toBe("libghostty");
    const commandsBefore = nativeLifecycleCommandCounts();

    click(maximizeButton());
    expect(panelHeight()).toBe(currentMaximum());
    expect(screen.getByTestId("native-terminal-host")).toBe(nativeHost);
    click(maximizeButton());
    expect(panelHeight()).toBe(280);
    expect(screen.getByTestId("native-terminal-host")).toBe(nativeHost);

    expect(nativeLifecycleCommandCounts()).toEqual(commandsBefore);
    restoreFrame();
    expect(activeShellTabRunId()).toBe("run-shell-1");
    expect(shellApi.createModuleShell).toHaveBeenCalledTimes(1);
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    window.innerHeight = originalViewport;
  });
});
