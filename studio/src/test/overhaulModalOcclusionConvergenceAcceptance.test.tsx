/**
 * Modal occlusion convergence across viewers, races, and failures (CODING-723,
 * CODING-1498).
 *
 * Case 117 proves the single-viewer Settings integration. What is asserted here
 * is that the window-level occlusion policy *converges* on the production path:
 * `Terminal` renders native libghostty as a WebView sibling, so an open modal
 * hides no presented viewer — from any Studio surface — and issues no native
 * show when it closes. What the modal does take is input: the interaction map
 * lowers the selected native view and gives the WebView focus, keyboard
 * ownership and focus registration drop while the stack is non-empty, and a
 * focus request banked before the dialog opened is discarded. Attachment work
 * that lands under an open modal still presents beneath it, a pending
 * deactivation hide still settles on the latest activation intent, a
 * deactivated viewer is still hidden by its own owner change, and a failing
 * interaction hand-off — not a hide — leaves Settings usable behind the
 * established compatibility fallback.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { focusTerminal } from "../features/agents/terminal/internal/terminalRegistry";
import { useStudioStore } from "../features/projects/store";
import { isNativeTerminalKeyboardOwner } from "../runtime/nativeTerminalKeyboard";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
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

vi.mock("./legacyApiFixture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./legacyApiFixture")>()),
  ...settingsApi,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const FRAME = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  viewportWidth: 800,
  viewportHeight: 600,
};

const HANDLE_BY_RUN: Record<string, string> = {
  "run-1": "native-1",
  "run-2": "native-2",
};

/** A native command whose resolution the case controls explicitly. */
type Gate = { resolve: () => void; reject: (error: Error) => void };

let gates: Partial<Record<string, Gate[]>> = {};
let deferredCommands = new Set<string>();
let failingCommands = new Set<string>();

function deferralFor(command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    (gates[command] ??= []).push({
      resolve: () => resolve(),
      reject: (error) => reject(error),
    });
  });
}

async function releaseGate(command: string): Promise<void> {
  await waitFor(() => expect(gates[command]?.length ?? 0).toBeGreaterThan(0));
  const gate = gates[command]!.shift()!;
  await act(async () => {
    gate.resolve();
  });
}

function invocations(command: string): Record<string, unknown>[] {
  return tauri.invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function hidesOf(handle: string): Record<string, unknown>[] {
  return invocations("native_terminal_hide").filter(
    (args) => args.handle === handle,
  );
}

function showsOf(handle: string): Record<string, unknown>[] {
  return invocations("native_terminal_show").filter(
    (args) => args.handle === handle,
  );
}

function interactionsOf(handle: string): Record<string, unknown>[] {
  return invocations("native_terminal_set_webview_interaction").filter(
    (args) => args.handle === handle,
  );
}

/** The WebView owns input for this viewer (overlay geometry is incidental). */
function webviewOwnsInput(handle: string): Record<string, unknown> {
  return {
    handle,
    webviewFocus: true,
    overlayFrames: expect.any(Array),
    generation: expect.any(Number),
  };
}

const KEYBOARD_OWNER_1 = { handle: "native-1", runId: "run-1" };

function session(sessionId: string, taskId: string, runId: string) {
  return {
    sessionId,
    taskId,
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex" as const,
    status: "ready" as const,
    transport: "ready" as const,
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: runId,
  };
}

// The production surface: `Terminal` selects native libghostty and renders it
// as a WebView sibling. Cases never mount `NativeGhosttyTerminal` directly.
function TwoSurfaceStudio({
  panelActive = true,
}: {
  panelActive?: boolean;
}) {
  return (
    <>
      <Terminal sessionId="session-1" owner="studio" />
      <Terminal sessionId="session-2" owner="panel" active={panelActive} />
      <StudioFooter />
      <ModalHost />
    </>
  );
}

function SingleSurfaceStudio() {
  return (
    <>
      <Terminal sessionId="session-1" owner="studio" />
      <StudioFooter />
      <ModalHost />
    </>
  );
}

function presentedHosts(): HTMLElement[] {
  return screen
    .getAllByTestId("native-terminal-host")
    .filter((host) => host.hasAttribute("data-native-terminal-presented"));
}

async function openSettings(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
  return screen.findByRole("dialog", { name: "Studio settings" });
}

async function closeSettings(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  await waitFor(() => {
    expect(
      screen.queryByRole("dialog", { name: "Studio settings" }),
    ).not.toBeInTheDocument();
  });
}

/** A pointer press on the host hands input to the native view. */
async function selectNative(host: HTMLElement, handle: string): Promise<void> {
  fireEvent.pointerDown(host);
  await waitFor(() => {
    expect(interactionsOf(handle).at(-1)).toMatchObject({ webviewFocus: false });
  });
}

describe("overhaul acceptance — modal occlusion convergence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    installDesktopGraphQlRuntime();
    gates = {};
    deferredCommands = new Set();
    failingCommands = new Set();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
        "session-1": session("session-1", "task-1", "run-1"),
        "session-2": session("session-2", "task-2", "run-2"),
      },
      sessionByRun: { "run-1": "session-1", "run-2": "session-2" },
    });

    settingsApi.getLaunchProviderCapabilities.mockResolvedValue([]);
    settingsApi.getProviderCatalog.mockResolvedValue({
      value: {
        activated_providers: ["claude"],
        global_default: { provider: "claude", model: "sonnet", reasoning: "high" },
      },
    });
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (failingCommands.has(command)) {
          throw new Error(`native ${command} failed`);
        }
        if (deferredCommands.has(command)) await deferralFor(command);
        if (command === "native_terminal_available") return true;
        const handle =
          (args?.handle as string | undefined) ??
          HANDLE_BY_RUN[String(args?.runId)];
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return {
            handle,
            runId: String(args?.runId ?? ""),
            columns: 100,
            rows: 30,
          };
        }
        return undefined;
      },
    );
  });

  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    vi.unstubAllGlobals();
  });

  it("[overhaul-118] keeps every presented native viewer on screen under an open modal, hands input to the WebView, and hides only a viewer its own surface deactivates", async () => {
    const view = render(<TwoSurfaceStudio />);

    // Two viewers from different Studio surfaces are presented together and
    // both register in the window interaction map with the WebView in charge.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
      expect(showsOf("native-2")).toHaveLength(1);
      expect(presentedHosts()).toHaveLength(2);
      expect(interactionsOf("native-1").at(-1)).toEqual(webviewOwnsInput("native-1"));
      expect(interactionsOf("native-2").at(-1)).toEqual(webviewOwnsInput("native-2"));
    });
    await selectNative(presentedHosts()[0]!, "native-1");

    const dialog = await openSettings();
    // The modal lowers the selected native view behind its own frame …
    await waitFor(() => {
      expect(interactionsOf("native-1").at(-1)).toEqual(webviewOwnsInput("native-1"));
    });
    // … and that is all it does: nothing is hidden, detached, or re-attached.
    expect(hidesOf("native-1")).toHaveLength(0);
    expect(hidesOf("native-2")).toHaveLength(0);
    expect(presentedHosts()).toHaveLength(2);
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(2);

    await closeSettings(dialog);

    // Closing reveals nothing because nothing was concealed.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(showsOf("native-2")).toHaveLength(1);
    expect(presentedHosts()).toHaveLength(2);

    // The panel deactivates its surface while the modal is open. Its own owner
    // change hides that viewer alone; the modal never joins in.
    const reopened = await openSettings();
    view.rerender(<TwoSurfaceStudio panelActive={false} />);
    await waitFor(() => {
      expect(hidesOf("native-2")).toHaveLength(1);
    });
    expect(hidesOf("native-1")).toHaveLength(0);
    await waitFor(() => expect(presentedHosts()).toHaveLength(1));

    await closeSettings(reopened);

    // A deactivated viewer is not entitled to come back when the modal closes.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(showsOf("native-2")).toHaveLength(1);
    expect(hidesOf("native-1")).toHaveLength(0);

    view.unmount();
  });

  it("[overhaul-118-late] presents attachment work that completes while the modal stack is non-empty beneath the WebView", async () => {
    deferredCommands.add("native_terminal_attach");
    const view = render(<SingleSurfaceStudio />);

    await waitFor(() => {
      expect(invocations("native_terminal_attach")).toHaveLength(1);
    });
    // Settings opens while the very first attachment is still in flight.
    const dialog = await openSettings();

    await releaseGate("native_terminal_attach");

    // The attachment completes and presents under the dialog: a sibling view
    // has no reason to wait, and the WebView already owns its input.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
      expect(interactionsOf("native-1").at(-1)).toEqual(webviewOwnsInput("native-1"));
    });
    expect(showsOf("native-1").at(-1)).toEqual({ handle: "native-1", frame: FRAME });
    expect(hidesOf("native-1")).toHaveLength(0);
    expect(useModalStore.getState().modalStack).toHaveLength(1);
    expect(dialog).toBeVisible();

    await closeSettings(dialog);

    // Closing issues no second show for a viewer that never left the screen.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(hidesOf("native-1")).toHaveLength(0);
    expect(presentedHosts()).toHaveLength(1);

    view.unmount();
  });

  it("[overhaul-118-race] settles a pending deactivation hide on the latest activation intent across a modal episode", async () => {
    const view = render(<TwoSurfaceStudio />);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
      expect(showsOf("native-2")).toHaveLength(1);
    });

    // The panel deactivates and its hide stalls in native code.
    deferredCommands.add("native_terminal_hide");
    view.rerender(<TwoSurfaceStudio panelActive={false} />);
    await waitFor(() => {
      expect(hidesOf("native-2")).toHaveLength(1);
    });

    // Settings opens and closes, and the panel reactivates, all while that
    // hide is still unresolved. No reveal may run ahead of the queued hide.
    const dialog = await openSettings();
    view.rerender(<TwoSurfaceStudio panelActive />);
    await closeSettings(dialog);
    expect(showsOf("native-2")).toHaveLength(1);

    // The pending hide resolves; the latest intent is "active", so exactly one
    // reveal follows it, measured against the panel's own host.
    deferredCommands.delete("native_terminal_hide");
    await releaseGate("native_terminal_hide");
    await waitFor(() => {
      expect(showsOf("native-2")).toHaveLength(2);
    });
    expect(showsOf("native-2").at(-1)).toEqual({ handle: "native-2", frame: FRAME });
    // Every hide the deactivation produced settled before that reveal ran.
    const panelCalls = tauri.invoke.mock.calls
      .filter((call) => (call[1] as { handle?: string } | undefined)?.handle === "native-2")
      .map((call) => call[0] as string)
      .filter((command) => command === "native_terminal_hide" || command === "native_terminal_show");
    expect(panelCalls.at(-1)).toBe("native_terminal_show");
    expect(panelCalls.filter((command) => command === "native_terminal_show")).toHaveLength(2);

    // The other surface's viewer was never part of the episode.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(hidesOf("native-1")).toHaveLength(0);
    expect(presentedHosts()).toHaveLength(2);

    view.unmount();
  });

  it("[overhaul-118-focus] releases focus and keyboard ownership to the modal without hiding the viewer, and returns focus to the Settings opener", async () => {
    const view = render(<SingleSurfaceStudio />);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
      expect(interactionsOf("native-1")).toHaveLength(1);
    });

    // The presented viewer takes focus and keyboard ownership normally.
    act(() => focusTerminal("session-1"));
    await waitFor(() => {
      expect(invocations("native_terminal_focus")).toHaveLength(1);
    });
    expect(isNativeTerminalKeyboardOwner(KEYBOARD_OWNER_1)).toBe(true);
    await selectNative(screen.getByTestId("native-terminal-host"), "native-1");

    // A real pointer activation focuses the action it presses; jsdom's
    // synthetic click does not, so model the focus the opener actually holds.
    const opener = screen.getByRole("button", { name: "Open Settings" });
    act(() => opener.focus());
    const dialog = await openSettings();

    // Input moves to the WebView: the selected view is lowered, keyboard
    // ownership is released, and the viewer itself stays presented.
    await waitFor(() => {
      expect(interactionsOf("native-1").at(-1)).toEqual(webviewOwnsInput("native-1"));
    });
    expect(isNativeTerminalKeyboardOwner(KEYBOARD_OWNER_1)).toBe(false);
    expect(hidesOf("native-1")).toHaveLength(0);
    expect(presentedHosts()).toHaveLength(1);

    // While the modal owns the foreground a focus request reaches no viewer.
    act(() => focusTerminal("session-1"));
    expect(invocations("native_terminal_focus")).toHaveLength(1);

    await closeSettings(dialog);

    // A pointer-opened dialog restores focus to the action that opened it;
    // ownership returns to the viewer, but no focus is stolen back into it.
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await waitFor(() => {
      expect(isNativeTerminalKeyboardOwner(KEYBOARD_OWNER_1)).toBe(true);
    });
    expect(showsOf("native-1")).toHaveLength(1);
    expect(invocations("native_terminal_focus")).toHaveLength(1);

    view.unmount();
  });

  it("[overhaul-118-focus-banked] drops a focus request banked before the dialog opened instead of delivering it when the modal closes", async () => {
    // The tab is selected while its viewer is still attaching, so the request
    // is banked with no focuser to take it.
    deferredCommands.add("native_terminal_attach");
    const view = render(<SingleSurfaceStudio />);
    await waitFor(() => {
      expect(invocations("native_terminal_attach")).toHaveLength(1);
    });
    act(() => focusTerminal("session-1"));

    const opener = screen.getByRole("button", { name: "Open Settings" });
    act(() => opener.focus());
    const dialog = await openSettings();

    // The attachment lands under the dialog: it presents, but takes no focus.
    deferredCommands.delete("native_terminal_attach");
    await releaseGate("native_terminal_attach");
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    await closeSettings(dialog);

    // The viewer registers for focus once the modal closes — but the banked
    // request did not survive the occlusion episode, so focus stays with the
    // opener and no second show is issued.
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(showsOf("native-1")).toHaveLength(1);
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    // The registry is still live: an explicit request now reaches the viewer.
    act(() => focusTerminal("session-1"));
    await waitFor(() => {
      expect(invocations("native_terminal_focus")).toHaveLength(1);
    });

    view.unmount();
  });

  it("[overhaul-118-failure] keeps Settings visible and interactive when the input hand-off to the WebView fails, falling back to the compatibility renderer", async () => {
    const view = render(<SingleSurfaceStudio />);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });
    await selectNative(screen.getByTestId("native-terminal-host"), "native-1");

    // Opening the modal must lower the selected native view. That hand-off —
    // not a hide, which no longer happens — is what fails here.
    failingCommands.add("native_terminal_set_webview_interaction");
    const dialog = await openSettings();

    // The established fallback seam takes the failed viewer out of service and
    // the production surface swaps in the compatibility renderer.
    const notice = await screen.findByTestId("native-terminal-fallback-notice");
    expect(notice).toHaveTextContent("native_terminal_set_webview_interaction failed");
    expect(screen.queryByTestId("native-terminal-host")).not.toBeInTheDocument();
    expect(hidesOf("native-1")).toHaveLength(0);
    await waitFor(() => {
      expect(invocations("native_terminal_detach")).toHaveLength(1);
    });

    // Settings survives the native failure: still mounted, still operable.
    expect(dialog).toBeVisible();
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(close).toBeEnabled();
    fireEvent.click(close);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Studio settings" }),
      ).not.toBeInTheDocument();
    });
    // A failed viewer is not revealed again once the modal stack empties.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(screen.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();

    view.unmount();
  });
});
