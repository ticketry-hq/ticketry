/**
 * Settings over an attached native terminal (CODING-718 / CODING-722).
 *
 * Case 66 already proves the native half in isolation by writing the modal
 * stack directly. What is asserted here is the integration users actually hit:
 * the real footer Settings action and the real global Settings binding, taken
 * while one libghostty viewer is attached and presented, must expose the
 * singleton dialog and commit a native hide — without detaching the viewer,
 * releasing its lease, closing the terminal, or ending the run — and closing
 * the dialog must remeasure the host and reveal the same handle.
 */

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { StudioFooter } from "../app/shell/StudioFooter";
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { focusTerminal } from "../features/agents/terminal/internal/terminalRegistry";
import { useStudioStore } from "../features/projects/store";
import { useClientStore } from "../state/clientStore";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  /** Host event handlers Studio has subscribed, keyed by event name. */
  hostListeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauri.listen,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => null,
  registerPoolDriver: () => () => {},
  releasePooledTransport: vi.fn(),
  syncEntries: vi.fn(),
}));

const settingsApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
  getProviderCatalog: vi.fn(),
  putProviderCatalog: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...settingsApi,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const HANDLE = "native-1";
const FRAME = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  viewportWidth: 800,
  viewportHeight: 600,
};

const NATIVE_STATUS = {
  handle: HANDLE,
  runId: "run-1",
  columns: 100,
  rows: 30,
};

let hostRequests: string[] = [];

/**
 * Stands in for the engaged native view recognising the Settings chord.
 *
 * While the libghostty view is first responder AppKit delivers the key to it
 * and the WebView receives no `keydown` at all, so this — not a synthetic
 * window keydown — is the route a real terminal leaves open (#735).
 */
function reportNativeSettingsChord(): void {
  tauri.hostListeners.get(NATIVE_TERMINAL_CHORD_EVENT)?.({
    payload: { handle: HANDLE, runId: "run-1", chord: "settings" },
  });
}

function invocations(command: string): unknown[][] {
  return tauri.invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => call.slice(1));
}

function renderStudioWithAttachedTerminal() {
  return render(
    <>
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />
      <StudioFooter />
      <ModalHost />
    </>,
  );
}

/** Resolves once the viewer has attached and committed its first reveal. */
async function waitForPresentedViewer() {
  await waitFor(() => {
    expect(invocations("native_terminal_show")).toHaveLength(1);
  });
}

describe("overhaul acceptance — Settings over an attached native terminal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hostRequests = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        hostRequests.push(String(input));
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
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
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ activeByTask: {} });
    useStudioStore.setState({ selectedProjectId: "project-1" });
    useTerminalStore.setState({
      sessions: {
        "session-1": {
          sessionId: "session-1",
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
      sessionByRun: { "run-1": "session-1" },
    });

    settingsApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    settingsApi.getProviderCatalog.mockResolvedValue({
      value: {
        activated_providers: ["claude"],
        global_default: { provider: "claude", model: "sonnet", reasoning: "high" },
      },
    });
    tauri.hostListeners.clear();
    tauri.listen.mockImplementation(
      async (event: string, handler: (event: unknown) => void) => {
        tauri.hostListeners.set(event, handler);
        return () => tauri.hostListeners.delete(event);
      },
    );
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (
        command === "native_terminal_attach" ||
        command === "native_terminal_show" ||
        command === "native_terminal_set_frame" ||
        command === "native_terminal_reconcile_frame"
      ) {
        return Promise.resolve(NATIVE_STATUS);
      }
      return Promise.resolve();
    });
  });

  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    vi.unstubAllGlobals();
  });

  it("[overhaul-117] opens Settings from the footer over a presented native terminal, hides that viewer without tearing it down, and restores the same handle on close", async () => {
    const view = renderStudioWithAttachedTerminal();
    await waitForPresentedViewer();

    const leaseAcquisitions = hostRequests.filter((url) =>
      url.endsWith("/api/terminals/viewers/lease"),
    ).length;
    expect(leaseAcquisitions).toBe(1);
    const requestsBeforeSettings = hostRequests.length;

    // The real footer action, not the modal store.
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));

    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    expect(dialog).toBeVisible();
    // The scrim owns the foreground; its dialog stays interactive.
    expect(dialog.parentElement).toHaveClass("fixed", "inset-0", "bg-black/60");
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeEnabled();

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: HANDLE,
      });
    });

    // Occlusion is presentation only: no detach, no second attachment, no
    // lease traffic, no terminal close, and the run keeps its session.
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(1);
    expect(hostRequests).toHaveLength(requestsBeforeSettings);
    expect(useTerminalStore.getState().sessions["session-1"]).toMatchObject({
      agentRunId: "run-1",
      status: "ready",
    });

    // A hidden viewer cannot accept focus while the dialog is up.
    act(() => focusTerminal("session-1"));
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Studio settings" }),
      ).not.toBeInTheDocument();
    });

    // The same handle is revealed against the host's current measurement.
    await waitFor(() => {
      expect(invocations("native_terminal_show")).toHaveLength(2);
    });
    expect(invocations("native_terminal_show").at(-1)).toEqual([
      { handle: HANDLE, frame: FRAME },
    ]);
    expect(invocations("native_terminal_attach")).toHaveLength(1);
    expect(
      hostRequests.filter((url) => url.endsWith("/api/terminals/viewers/lease")),
    ).toHaveLength(1);
    expect(
      hostRequests.some((url) => url.includes("/lease/release")),
    ).toBe(false);

    view.unmount();
  });

  it("[overhaul-117-keymap] reaches the same singleton dialog from the native Settings chord while the terminal owns focus", async () => {
    const view = renderStudioWithAttachedTerminal();
    const keymap = renderHook(() => useGlobalKeymap());
    await waitForPresentedViewer();

    // The presented viewer owns keyboard focus before the chord is used.
    act(() => focusTerminal("session-1"));
    await waitFor(() => {
      expect(invocations("native_terminal_focus")).toHaveLength(1);
    });

    act(() => {
      reportNativeSettingsChord();
    });

    const dialog = await screen.findByRole("dialog", { name: "Studio settings" });
    expect(dialog).toBeVisible();
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: HANDLE,
      });
    });

    // Terminal input is suspended: the hidden viewer neither takes focus nor
    // opens a second Settings from another report of the same chord.
    act(() => focusTerminal("session-1"));
    act(() => {
      reportNativeSettingsChord();
    });
    expect(invocations("native_terminal_focus")).toHaveLength(1);
    expect(useModalStore.getState().modalStack).toEqual([{ type: "settings" }]);

    keymap.unmount();
    view.unmount();
  });

});
