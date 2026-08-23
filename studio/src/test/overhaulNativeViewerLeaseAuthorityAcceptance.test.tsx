import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
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

  it("[overhaul-23] retires fallback before claiming and revealing a prepared native viewer", async () => {
    const lifecycle: string[] = [];
    let commitLease!: () => void;
    const leaseCommitted = new Promise<void>((resolve) => {
      commitLease = resolve;
    });
    vi.mocked(releasePooledTransport).mockImplementation(() => {
      lifecycle.push("release_fallback");
    });
    const host = vi.fn();
    vi.stubGlobal("fetch", host);
    const operations = installDesktopGraphQlRuntime(async (document, variables) => {
      lifecycle.push(document.operationName);
      if (document.operationName === "CreateViewerLease") await leaseCommitted;
      return grantsEveryLease(document, variables);
    });
    tauri.invoke.mockImplementation((command: string) => {
      lifecycle.push(command);
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
    const ready = vi.fn();

    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={ready}
      />,
    );

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_attach",
        expect.anything(),
      );
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_show",
      expect.anything(),
    );

    commitLease();
    await waitFor(() => expect(ready).toHaveBeenCalled());
    // Ownership is claimed on the Rust lease contract, not a host route.
    expect(operations[0]).toEqual({
      operationName: "CreateViewerLease",
      variables: expect.objectContaining({
        agentRunId: "run-1",
        transport: "native",
      }),
    });
    expect(host).not.toHaveBeenCalled();
    expect(lifecycle.indexOf("native_terminal_attach")).toBeLessThan(
      lifecycle.indexOf("release_fallback"),
    );
    expect(lifecycle.indexOf("release_fallback")).toBeLessThan(
      lifecycle.indexOf("CreateViewerLease"),
    );
    expect(lifecycle.indexOf("CreateViewerLease")).toBeLessThan(
      lifecycle.indexOf("native_terminal_show"),
    );

    view.unmount();

    await waitFor(() => {
      expect(operations.some((operation) =>
        operation.operationName === "DeleteViewerLease",
      )).toBe(true);
    });
    expect(host).not.toHaveBeenCalled();
    expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
    expect(lifecycle.indexOf("native_terminal_detach")).toBeLessThan(
      lifecycle.indexOf("DeleteViewerLease"),
    );
  });

  it("keeps a slow first attachment hidden when its host loses presentation authority", async () => {
    let commitLease!: () => void;
    const leaseCommitted = new Promise<void>((resolve) => {
      commitLease = resolve;
    });
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (document.operationName === "CreateViewerLease") await leaseCommitted;
      return grantsEveryLease(document, variables);
    });
    const ready = vi.fn();
    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active
        onReady={ready}
      />,
    );
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith(
        "native_terminal_attach",
        expect.anything(),
      );
    });

    view.rerender(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active={false}
        onReady={ready}
      />,
    );
    commitLease();

    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_show",
      expect.anything(),
    );
    expect(releasePooledTransport).toHaveBeenCalledWith("session-1");
    view.unmount();
  });

  it("releases ownership after an in-flight acquire commits during unmount", async () => {
    let commitAcquire!: () => void;
    const acquireCommitted = new Promise<void>((resolve) => {
      commitAcquire = resolve;
    });
    const operations = installDesktopGraphQlRuntime(async (document, variables) => {
      if (document.operationName === "CreateViewerLease") await acquireCommitted;
      return grantsEveryLease(document, variables);
    });
    const released = () =>
      operations.some((operation) => operation.operationName === "DeleteViewerLease");

    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />,
    );
    await waitFor(() => expect(operations).toHaveLength(1));

    view.unmount();
    expect(released()).toBe(false);

    commitAcquire();
    await waitFor(() => {
      expect(released()).toBe(true);
    });
    expect(tauri.invoke).toHaveBeenCalledWith(
      "native_terminal_attach",
      expect.anything(),
    );
  });

});
