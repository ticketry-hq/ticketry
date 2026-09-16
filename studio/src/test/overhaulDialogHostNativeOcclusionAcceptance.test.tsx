/**
 * DialogHost confirms over a presented native viewer (CODING-733).
 *
 * Case 118 proves the convergence policy through the modal stack. Studio raises
 * a second, independent window-level overlay: the confirm dialogs `DialogHost`
 * renders from the client store's dialog bus (Delete issue, Discard document).
 * What is asserted here is that the occlusion rule is the OR over both surfaces
 * — a confirm raised while the terminal panel presents a native shell viewer
 * hands input to the WebView without hiding or tearing the viewer down, keeps
 * it presented and focus-free while the confirm is up, and leaves its measured
 * frame untouched once the person answers. `DialogHost` is the only coverage
 * of the dialog-bus branch of `modalOcclusionActive`, so the case stays here.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DialogHost } from "../app/shell/DialogHost";
import { useModalStore } from "../app/modal/modalStore";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { focusTerminal } from "../features/agents/terminal/internal/terminalRegistry";
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

function invocations(command: string): Record<string, unknown>[] {
  return tauri.invoke.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function hides(): Record<string, unknown>[] {
  return invocations("native_terminal_hide").filter(
    (args) => args.handle === "native-shell",
  );
}

function shows(): Record<string, unknown>[] {
  return invocations("native_terminal_show").filter(
    (args) => args.handle === "native-shell",
  );
}

function interactions(): Record<string, unknown>[] {
  return invocations("native_terminal_set_webview_interaction").filter(
    (args) => args.handle === "native-shell",
  );
}

function presented(): boolean {
  return screen
    .getByTestId("native-terminal-host")
    .hasAttribute("data-native-terminal-presented");
}

/**
 * The bottom terminal panel's presented shell viewer, through the production
 * `Terminal` surface (native libghostty as a WebView sibling).
 */
function PanelShellStudio() {
  return (
    <>
      <Terminal sessionId="shell-1" owner="panel" />
      <DialogHost />
    </>
  );
}

// A zero-size host yields no clipped frame, so the lifecycle's first show is
// deferred exactly as it is when a run attaches before its panel has laid out.
let hostHasFrame = true;
let deferFirstShow = false;

describe("overhaul acceptance — DialogHost confirms over a native viewer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    installDesktopGraphQlRuntime();
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
    hostHasFrame = true;
    deferFirstShow = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => {
        const edge = hostHasFrame ? { right: 800, bottom: 600 } : { right: 0, bottom: 0 };
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          width: edge.right,
          height: edge.bottom,
          toJSON: () => ({}),
          ...edge,
        };
      },
    );
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ dialogs: [] });
    useTerminalStore.setState({
      sessions: {
        "shell-1": {
          sessionId: "shell-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex" as const,
          status: "ready" as const,
          transport: "ready" as const,
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-shell",
        },
      },
      sessionByRun: { "run-shell": "shell-1" },
    });

    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "native_terminal_available") return true;
        if (command === "native_terminal_attach" && deferFirstShow) {
          // The panel loses its frame between attach and first show — the
          // lifecycle attaches, then finds nothing to present into.
          hostHasFrame = false;
          deferFirstShow = false;
        }
        if (
          command === "native_terminal_attach" ||
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame" ||
          command === "native_terminal_reconcile_frame"
        ) {
          return {
            handle: (args?.handle as string | undefined) ?? "native-shell",
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
    useClientStore.setState({ dialogs: [] });
    vi.unstubAllGlobals();
  });

  it("[overhaul-277] keeps a presented panel viewer on screen under a DialogHost confirm, hands input to the WebView, and leaves its frame untouched when the confirm is answered", async () => {
    const view = render(<PanelShellStudio />);

    await waitFor(() => {
      expect(shows()).toHaveLength(1);
    });
    expect(presented()).toBe(true);

    // The viewer owns input before the confirm is raised.
    fireEvent.pointerDown(screen.getByTestId("native-terminal-host"));
    await waitFor(() => {
      expect(interactions().at(-1)).toMatchObject({ webviewFocus: false });
    });

    // The Details tab's delete path: a confirm raised on the client store's
    // dialog bus, with no modal-stack entry anywhere.
    let answer: Promise<boolean> | null = null;
    act(() => {
      answer = useClientStore.getState().confirm({
        title: "Delete issue",
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
    });

    const dialog = await screen.findByRole("dialog", { name: "Delete issue" });
    expect(useModalStore.getState().modalStack).toHaveLength(0);

    // Input moves to the WebView; the viewer is neither hidden nor torn down.
    await waitFor(() => {
      expect(interactions().at(-1)).toMatchObject({ webviewFocus: true });
    });
    expect(hides()).toHaveLength(0);
    expect(presented()).toBe(true);
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    // While the confirm is up the viewer takes no focus.
    act(() => focusTerminal("shell-1"));
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    within(dialog).getByRole("button", { name: "Delete" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete issue" })).not.toBeInTheDocument();
    });
    await expect(answer!).resolves.toBe(true);

    // Nothing was hidden, so nothing is re-shown, the measured frame is
    // unchanged, and focus is not stolen back into the viewer.
    await act(async () => {});
    expect(hides()).toHaveLength(0);
    expect(invocations("native_terminal_focus")).toHaveLength(0);
    expect(shows()).toHaveLength(1);
    expect(shows()[0]).toEqual({ handle: "native-shell", frame: FRAME });
    expect(presented()).toBe(true);
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    view.unmount();
  });

  it("[overhaul-278] presents a late-attaching panel viewer beneath an open Settings modal without waiting for it to close (CODING-1500)", async () => {
    act(() => useModalStore.getState().openSettings());
    expect(useModalStore.getState().modalStack).toHaveLength(1);

    // The host loses its frame right after attach: the lifecycle's first
    // show finds nothing to present into and defers.
    deferFirstShow = true;
    const view = render(<Terminal sessionId="shell-1" owner="panel" active />);
    await waitFor(() => {
      expect(invocations("native_terminal_attach")).toHaveLength(1);
    });
    await act(async () => {});
    expect(shows()).toHaveLength(0);
    expect(presented()).toBe(false);

    // The host lays out and the surface re-commits visibility while Settings
    // is still up. On the sibling path the modal is not an occluder, so the
    // queued reveal must present beneath the dialog rather than cancel.
    hostHasFrame = true;
    view.rerender(<Terminal sessionId="shell-1" owner="panel" active={false} />);
    view.rerender(<Terminal sessionId="shell-1" owner="panel" active />);
    await waitFor(() => {
      expect(shows()).toHaveLength(1);
    });
    expect(shows()[0]).toEqual({ handle: "native-shell", frame: FRAME });
    expect(useModalStore.getState().modalStack).toHaveLength(1);
    await waitFor(() => {
      expect(presented()).toBe(true);
    });
    expect(hides()).toHaveLength(0);

    // Closing Settings changes nothing: the viewer was already on screen.
    act(() => useModalStore.getState().popModal());
    await act(async () => {});
    expect(shows()).toHaveLength(1);
    expect(hides()).toHaveLength(0);
    expect(presented()).toBe(true);

    view.unmount();
  });
});
