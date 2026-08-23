/**
 * DialogHost confirms over a presented native viewer (CODING-733).
 *
 * Case 118 proves the convergence policy through the modal stack. Studio raises
 * a second, independent window-level overlay: the confirm dialogs `DialogHost`
 * renders from the client store's dialog bus (Delete issue, Discard document).
 * What is asserted here is that the occlusion rule is the OR over both surfaces
 * — a confirm raised while the terminal panel presents a native shell viewer
 * hides that viewer without tearing it down, keeps it hidden while the confirm
 * is up, and reveals the same handle against a fresh measurement once the
 * person answers.
 */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DialogHost } from "../app/shell/DialogHost";
import { useModalStore } from "../app/modal/modalStore";
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
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

/** The bottom terminal panel's presented shell viewer. */
function PanelShellStudio() {
  return (
    <>
      <NativeGhosttyTerminal sessionId="shell-1" owner="panel" />
      <DialogHost />
    </>
  );
}

describe("overhaul acceptance — DialogHost confirms over a native viewer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("[overhaul-118-dialog] hides a presented panel viewer for a DialogHost confirm and reveals it again when the confirm is answered", async () => {
    const view = render(<PanelShellStudio />);

    await waitFor(() => {
      expect(shows()).toHaveLength(1);
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

    // The native viewer is hidden — presentation only, no teardown.
    await waitFor(() => {
      expect(hides()).toHaveLength(1);
    });
    expect(invocations("native_terminal_detach")).toHaveLength(0);
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    // While the confirm is up the hidden viewer takes no focus either.
    act(() => focusTerminal("shell-1"));
    expect(invocations("native_terminal_focus")).toHaveLength(0);

    within(dialog).getByRole("button", { name: "Delete" }).click();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete issue" })).not.toBeInTheDocument();
    });
    await expect(answer!).resolves.toBe(true);

    // Answering the confirm empties the last overlay surface, so the same
    // handle comes back measured against its current host.
    await waitFor(() => {
      expect(shows()).toHaveLength(2);
    });
    expect(shows().at(-1)).toEqual({ handle: "native-shell", frame: FRAME });
    expect(invocations("native_terminal_attach")).toHaveLength(1);

    view.unmount();
  });
});
