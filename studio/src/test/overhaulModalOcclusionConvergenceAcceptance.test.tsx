/**
 * Modal occlusion convergence across viewers, races, and failures (CODING-723).
 *
 * Case 117 proves the single-viewer Settings integration. What is asserted here
 * is that the window-level occlusion policy *converges*: every presentable
 * native viewer — from any Studio surface — hides for any open modal, work that
 * finishes while the stack is non-empty cannot commit a late reveal, out-of-order
 * native promises still settle on the latest modal/active/ownership intent, only
 * viewers still entitled to presentation come back, hidden viewers take no focus,
 * and a native visibility failure leaves Settings usable behind the established
 * compatibility fallback.
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
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { focusTerminal } from "../features/agents/terminal/internal/terminalRegistry";
import { useStudioStore } from "../features/projects/store";
import { useClientStore } from "../state/clientStore";

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

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
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

function TwoSurfaceStudio({
  panelActive = true,
}: {
  panelActive?: boolean;
}) {
  return (
    <>
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />
      <NativeGhosttyTerminal
        sessionId="session-2"
        owner="panel"
        active={panelActive}
        manageForegroundHost={false}
      />
      <StudioFooter />
      <ModalHost />
    </>
  );
}

function SingleSurfaceStudio() {
  return (
    <>
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />
      <StudioFooter />
      <ModalHost />
    </>
  );
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

describe("overhaul acceptance — modal occlusion convergence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("[overhaul-118] hides every presentable native viewer for an open modal and restores only the viewers that are still active and owned", async () => {
    const view = render(<TwoSurfaceStudio />);

    // Two viewers from different Studio surfaces are presented together.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
      expect(showsOf("native-2")).toHaveLength(1);
    });

    const dialog = await openSettings();
    await waitFor(() => {
      expect(hidesOf("native-1")).toHaveLength(1);
      expect(hidesOf("native-2")).toHaveLength(1);
    });
    // Occlusion is presentation only, for every viewer.
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(2);

    await closeSettings(dialog);

    // Both come back, each measured freshly against its own current host.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(2);
      expect(showsOf("native-2")).toHaveLength(2);
    });
    expect(showsOf("native-1").at(-1)).toEqual({ handle: "native-1", frame: FRAME });
    expect(showsOf("native-2").at(-1)).toEqual({ handle: "native-2", frame: FRAME });

    // Ownership of the panel run moves away in the same commit that opens the
    // modal: the window-level rule still hides it, and it is no longer entitled
    // to come back when the modal closes.
    const reopened = await openSettings();
    act(() => {
      useTerminalForegroundStore.setState({
        claims: { "run-2": "drawer" },
      });
    });
    await waitFor(() => {
      expect(hidesOf("native-1")).toHaveLength(2);
      expect(hidesOf("native-2")).toHaveLength(2);
    });

    await closeSettings(reopened);

    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(3);
    });
    expect(showsOf("native-2")).toHaveLength(2);

    view.unmount();
  });

  it("[overhaul-118-late] refuses a reveal from attachment work that completes while the modal stack is non-empty", async () => {
    deferredCommands.add("native_terminal_attach");
    const view = render(<SingleSurfaceStudio />);

    await waitFor(() => {
      expect(invocations("native_terminal_attach")).toHaveLength(1);
    });
    // Settings opens while the very first attachment is still in flight.
    const dialog = await openSettings();

    await releaseGate("native_terminal_attach");

    // The attachment completed — and committed no show behind the dialog.
    await waitFor(() => {
      expect(useModalStore.getState().modalStack).toHaveLength(1);
    });
    expect(showsOf("native-1")).toHaveLength(0);
    expect(dialog).toBeVisible();

    await closeSettings(dialog);

    // Only an empty modal stack lets the prepared viewer take the screen.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });
    expect(showsOf("native-1").at(-1)).toEqual({ handle: "native-1", frame: FRAME });

    view.unmount();
  });

  it("[overhaul-118-race] settles on the latest modal intent when native hide and show resolve out of order", async () => {
    const view = render(<SingleSurfaceStudio />);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });

    // Close/reopen: the reveal is queued behind a hide that has not resolved,
    // and the modal comes back before the queue reaches it.
    deferredCommands.add("native_terminal_hide");
    const dialog = await openSettings();
    await waitFor(() => {
      expect(invocations("native_terminal_hide")).toHaveLength(1);
    });
    await closeSettings(dialog);
    const reopened = await openSettings();

    // The pending hide now resolves, releasing the queued reveal behind it.
    deferredCommands.delete("native_terminal_hide");
    await releaseGate("native_terminal_hide");

    // Latest intent is "modal open", so nothing was revealed over the dialog.
    expect(showsOf("native-1")).toHaveLength(1);
    expect(reopened).toBeVisible();

    // Closing for real converges the other way.
    await closeSettings(reopened);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(2);
    });

    view.unmount();
  });

  it("[overhaul-118-focus] keeps focus away from hidden viewers and returns it to the Settings opener", async () => {
    const view = render(<SingleSurfaceStudio />);
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });

    // The presented viewer takes focus normally.
    act(() => focusTerminal("session-1"));
    await waitFor(() => {
      expect(invocations("native_terminal_focus")).toHaveLength(1);
    });

    // A real pointer activation focuses the action it presses; jsdom's
    // synthetic click does not, so model the focus the opener actually holds.
    const opener = screen.getByRole("button", { name: "Open Settings" });
    act(() => opener.focus());
    const dialog = await openSettings();
    await waitFor(() => {
      expect(hidesOf("native-1")).toHaveLength(1);
    });

    // A hidden viewer neither registers for focus nor consumes a focus signal.
    act(() => focusTerminal("session-1"));
    expect(invocations("native_terminal_focus")).toHaveLength(1);

    await closeSettings(dialog);

    // A pointer-opened dialog restores focus to the action that opened it, and
    // the reveal alone does not steal focus back into the terminal.
    await waitFor(() => expect(document.activeElement).toBe(opener));
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(2);
    });
    expect(invocations("native_terminal_focus")).toHaveLength(1);

    view.unmount();
  });

  it("[overhaul-118-focus-banked] drops a focus request banked before the dialog opened instead of delivering it on the post-close reveal", async () => {
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

    // The attachment lands behind the dialog: no reveal, and no focus.
    deferredCommands.delete("native_terminal_attach");
    await releaseGate("native_terminal_attach");
    expect(showsOf("native-1")).toHaveLength(0);
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    await closeSettings(dialog);

    // The reveal commits and the viewer registers — but the banked request did
    // not survive the occlusion episode, so focus stays with the opener.
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    // The registry is still live: an explicit request now reaches the viewer.
    act(() => focusTerminal("session-1"));
    await waitFor(() => {
      expect(invocations("native_terminal_focus")).toHaveLength(1);
    });

    view.unmount();
  });

  it("[overhaul-118-failure] keeps Settings visible and interactive when the native hide fails, falling back to the compatibility renderer", async () => {
    const unavailable = vi.fn();
    const view = render(
      <>
        <NativeGhosttyTerminal
          sessionId="session-1"
          owner="studio"
          onUnavailable={unavailable}
        />
        <StudioFooter />
        <ModalHost />
      </>,
    );
    await waitFor(() => {
      expect(showsOf("native-1")).toHaveLength(1);
    });

    failingCommands.add("native_terminal_hide");
    const dialog = await openSettings();

    // The established fallback seam takes the failed viewer out of service.
    await waitFor(() => {
      expect(unavailable).toHaveBeenCalledWith(expect.stringContaining("failed"));
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

    view.unmount();
  });
});
