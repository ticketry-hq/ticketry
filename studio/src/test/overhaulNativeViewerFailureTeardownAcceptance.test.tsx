import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { releasePooledTransport } from "../features/agents/terminal/internal/entryPool";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import {
  grantsEveryLease,
  installDesktopGraphQlRuntime,
} from "./desktopGraphQlRuntime";

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

describe("native viewer attachment acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  beforeEach(() => {
    vi.resetAllMocks();
    installDesktopGraphQlRuntime();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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
    tauri.listen.mockResolvedValue(() => {});
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") {
        return Promise.resolve(true);
      }
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
  });

  it("[overhaul-68] tears down a failed retained viewer once and keeps navigation on the compatibility renderer", async () => {
    const originalSession = useTerminalStore.getState().sessions["session-1"];
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    tauri.listen.mockImplementation(
      async (event: string, listener: (event: { payload: unknown }) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    );
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime();
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_show") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });

    const view = render(<Terminal sessionId="session-1" active />);
    await waitFor(() => {
      expect(releasePooledTransport).toHaveBeenCalledWith("session-1");
    });
    view.rerender(<Terminal sessionId="session-1" active={false} />);
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_hide", {
        handle: "native-1",
      });
    });

    view.rerender(<Terminal sessionId="session-1" active />);
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-1" }),
      );
    });
    listeners.get("native-terminal-failed")?.({
      payload: {
        handle: "native-1",
        runId: "run-1",
        reason: "terminal attachment failed: tmux resize-window failed for 132x41",
      },
    });
    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "Native terminal unavailable: terminal attachment failed: tmux resize-window failed for 132x41. Using compatibility renderer.",
      );
    });
    expect(view.getByTestId("terminal-host")).toBeVisible();

    view.unmount();
    const remounted = render(<Terminal sessionId="session-1" active />);
    await waitFor(() => {
      expect(remounted.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "Native terminal unavailable: terminal attachment failed: tmux resize-window failed for 132x41. Using compatibility renderer.",
      );
    });
    await waitFor(() => {
      expect(leases("DeleteViewerLease")).toHaveLength(1);
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_attach"
    )).toHaveLength(1);
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(1);

    remounted.unmount();
    act(() => useTerminalStore.getState().closeTab("session-1"));
    act(() => {
      useTerminalStore.setState({
        sessions: {
          "session-2": { ...originalSession, sessionId: "session-2" },
        },
        sessionByRun: { "run-1": "session-2" },
      });
    });
    render(<Terminal sessionId="session-2" active />);
    await waitFor(() => {
      expect(tauri.invoke.mock.calls.filter(([command]) =>
        command === "native_terminal_attach"
      )).toHaveLength(2);
    });
  });

  it("tears down terminal completion and later dismissal idempotently", async () => {
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime();
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    const view = render(<Terminal sessionId="session-1" />);
    await waitFor(() => {
      expect(releasePooledTransport).toHaveBeenCalledWith("session-1");
    });

    act(() => useTerminalStore.getState().setExited("session-1"));
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());
    act(() => useTerminalStore.getState().closeTab("session-1"));
    view.rerender(<Terminal sessionId={null} />);

    await waitFor(() => {
      expect(leases("DeleteViewerLease")).toHaveLength(1);
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(1);
  });

  it("treats lease-renewal failures as terminal native failures", async () => {
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime(async (document, variables) => {
      if (document.operationName === "UpdateViewerLease") {
        throw new Error("lease renewal failed");
      }
      return grantsEveryLease(document, variables);
    });
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    let renewal: (() => void) | null = null;
    let markRenewalReady!: () => void;
    const renewalReady = new Promise<void>((resolve) => {
      markRenewalReady = resolve;
    });
    const interval = vi.spyOn(globalThis, "setInterval").mockImplementation((handler, delay) => {
      if (Number(delay) === 10_000) {
        renewal = handler as () => void;
        markRenewalReady();
      }
      return 7 as unknown as ReturnType<typeof setInterval>;
    });

    const view = render(<Terminal sessionId="session-1" />);
    await renewalReady;
    act(() => renewal?.());
    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "lease renewal failed",
      );
    });
    expect(leases("DeleteViewerLease")).toHaveLength(1);
    interval.mockRestore();
  });

  it("tears down and falls back when a live native frame update fails", async () => {
    let resize: (() => void) | null = null;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    let failFrame = false;
    tauri.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        if (failFrame) return Promise.reject(new Error("native resize failed"));
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });

    const view = render(<Terminal sessionId="session-1" />);
    await waitFor(() => expect(resize).not.toBeNull());
    failFrame = true;
    act(() => resize?.());

    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "native resize failed",
      );
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(1);
  });

  it("releases a retained viewer once when the WebView lifecycle ends", async () => {
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime();
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    const ready = vi.fn();
    render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={ready}
      />,
    );
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));

    await waitFor(() => {
      expect(leases("DeleteViewerLease")).toHaveLength(1);
    });
    expect(tauri.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(1);
  });

});
