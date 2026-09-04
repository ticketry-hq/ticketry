import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ToastHost from "../app/shell/ToastHost";
import { useModalStore } from "../app/modal/modalStore";
import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
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

function invocations(command: string): unknown[][] {
  return tauri.invoke.mock.calls.filter((call) => call[0] === command);
}

describe("toast viewport outside selected native Ghostty acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function rect(this: HTMLElement) {
        if (this.hasAttribute("data-studio-status-bar")) {
          return DOMRect.fromRect({ x: 0, y: 576, width: 800, height: 24 });
        }
        if (this.hasAttribute("data-native-terminal-presented")) {
          return DOMRect.fromRect({ x: 0, y: 300, width: 800, height: 276 });
        }
        return DOMRect.fromRect({ x: 16, y: 400, width: 360, height: 160 });
      },
    );
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useClientStore.setState({ toasts: [] });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    useTerminalStore.setState({
      sessions: {
        "session-toast": {
          sessionId: "session-toast",
          taskId: "task-toast",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-toast",
        },
      },
      sessionByRun: { "run-toast": "session-toast" },
    });
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return true;
      if (
        command === "native_terminal_attach" ||
        command === "native_terminal_show" ||
        command === "native_terminal_set_frame" ||
        command === "native_terminal_reconcile_frame"
      ) {
        return {
          handle: (args?.handle as string | undefined) ?? "native-toast",
          runId: String(args?.runId ?? "run-toast"),
          columns: 100,
          rows: 30,
        };
      }
      return undefined;
    });
  });

  afterEach(() => {
    useClientStore.setState({ toasts: [] });
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
    vi.unstubAllGlobals();
  });

  it("[overhaul-236] keeps stacked bottom-left toasts actionable without changing the selected native terminal", async () => {
    render(
      <>
        <NativeGhosttyTerminal
          sessionId="session-toast"
          owner="studio"
          webviewSiblingSpike
        />
        <div data-studio-status-bar />
        <ToastHost />
      </>,
    );

    const nativeHost = await screen.findByTestId("native-terminal-host");
    await waitFor(() => expect(invocations("native_terminal_attach")).toHaveLength(1));
    fireEvent.pointerDown(nativeHost);
    await waitFor(() => {
      expect(invocations("native_terminal_set_webview_interaction").at(-1)?.[1])
        .toMatchObject({ webviewFocus: false });
    });

    act(() => {
      useClientStore.getState().pushToast("success", "Saved");
      useClientStore.getState().pushToast("error", "Could not save");
    });

    const viewport = await screen.findByTestId("toast-host");
    expect(viewport).toHaveClass("fixed", "pointer-events-none", "overflow-y-auto");
    expect(viewport.style.left).toContain("safe-area-inset-left");
    expect(viewport.style.bottom).toContain("316px");
    expect(viewport.style.bottom).toContain("safe-area-inset-bottom");
    expect(viewport.style.maxHeight).toContain("safe-area-inset-top");
    expect(viewport).not.toContainElement(nativeHost);

    const success = screen.getByRole("status");
    const error = screen.getByRole("alert");
    expect(success).toHaveAttribute("aria-live", "polite");
    expect(error).toHaveAttribute("aria-live", "assertive");
    expect(success.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    const interactionCount = invocations("native_terminal_set_webview_interaction").length;
    const attachCount = invocations("native_terminal_attach").length;
    const hideCount = invocations("native_terminal_hide").length;
    const detachCount = invocations("native_terminal_detach").length;
    const focusCount = invocations("native_terminal_focus").length;
    const dismiss = screen.getAllByRole("button", { name: "Dismiss" })[0];
    expect(success).toHaveClass("pointer-events-auto");
    fireEvent.pointerDown(dismiss);
    fireEvent.click(dismiss);

    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Could not save")).toBeInTheDocument();
    expect(invocations("native_terminal_set_webview_interaction")).toHaveLength(interactionCount);
    expect(invocations("native_terminal_attach")).toHaveLength(attachCount);
    expect(invocations("native_terminal_hide")).toHaveLength(hideCount);
    expect(invocations("native_terminal_detach")).toHaveLength(detachCount);
    expect(invocations("native_terminal_focus")).toHaveLength(focusCount);
    expect(useTerminalStore.getState().sessions["session-toast"]?.agentRunId)
      .toBe("run-toast");
  });
});
