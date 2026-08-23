import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
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

  it("[overhaul-32] releases viewer ownership when the native attachment process exits", async () => {
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
    const ready = vi.fn();
    const unavailable = vi.fn();

    render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={ready}
        onUnavailable={unavailable}
      />,
    );
    await waitFor(() => expect(ready).toHaveBeenCalled());

    listeners.get("native-terminal-closed")?.({
      payload: {
        handle: "native-1",
        runId: "run-1",
        reason: "attachment_process_exited",
      },
    });

    await waitFor(() => {
      expect(leases("DeleteViewerLease").length > 0).toBe(true);
    });
    expect(unavailable).toHaveBeenCalledWith(
      "the native terminal attachment process exited",
    );
    expect(tauri.invoke).not.toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
  });

  it("[overhaul-27] ignores a delayed failure from the attachment it replaced", async () => {
    const failureListeners: Array<(event: {
      payload: { handle: string; runId: string; reason?: string };
    }) => void> = [];
    tauri.listen.mockImplementation(
      async (_event: string, listener: (event: {
        payload: { handle: string; runId: string; reason?: string };
      }) => void) => {
        failureListeners.push(listener);
        return () => {};
      },
    );
    let attachment = 0;
    tauri.invoke.mockImplementation((command: string, args?: { handle?: string }) => {
      if (command === "native_terminal_attach") {
        attachment += 1;
        return Promise.resolve({
          handle: `native-${attachment}`,
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      if (command === "native_terminal_set_frame") {
        return Promise.resolve({
          handle: args?.handle,
          runId: "run-1",
          columns: 100,
          rows: 30,
        });
      }
      return Promise.resolve();
    });
    // Viewer ownership is claimed and released on the Rust lease contract, so
    // what a test counts is lease operations, not host requests.
    const leaseOperations = installDesktopGraphQlRuntime();
    const leases = (operationName: string) =>
      leaseOperations.filter((operation) => operation.operationName === operationName);
    const firstUnavailable = vi.fn();
    const replacementUnavailable = vi.fn();
    const firstReady = vi.fn();
    const replacementReady = vi.fn();
    const firstView = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={firstReady}
        onUnavailable={firstUnavailable}
      />,
    );
    await waitFor(() => expect(firstReady).toHaveBeenCalled());
    firstView.unmount();
    await waitFor(() => {
      expect(leases("DeleteViewerLease")).toHaveLength(1);
    });

    render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={replacementReady}
        onUnavailable={replacementUnavailable}
      />,
    );
    await waitFor(() => expect(replacementReady).toHaveBeenCalled());
    const releasesBeforeStaleFailure = leases("DeleteViewerLease").length;

    failureListeners[0]({
      payload: {
        handle: "native-1",
        runId: "run-1",
        reason: "old attachment exited",
      },
    });

    expect(replacementUnavailable).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-2",
    });
    expect(leases("DeleteViewerLease")).toHaveLength(
      releasesBeforeStaleFailure,
    );
  });

});
