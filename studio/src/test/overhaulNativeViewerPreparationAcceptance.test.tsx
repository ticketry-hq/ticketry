import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { releasePooledTransport } from "../features/agents/terminal/internal/entryPool";
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
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    vi.resetAllMocks();
    localStorage.setItem("ticketry:terminal-renderer", "native");
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

  it("[overhaul-56] gates first attach and reattach on exact clipped-frame presentation while failures retain fallback", async () => {
    let finishFirstAttach!: (status: {
      handle: string;
      runId: string;
      columns: number;
      rows: number;
    }) => void;
    const firstAttach = new Promise<{
      handle: string;
      runId: string;
      columns: number;
      rows: number;
    }>((resolve) => {
      finishFirstAttach = resolve;
    });
    const attachFrames: unknown[] = [];
    let attachAttempt = 0;
    tauri.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") {
        attachFrames.push(args?.frame);
        attachAttempt += 1;
        if (attachAttempt === 1) return firstAttach;
        if (attachAttempt === 2) {
          return Promise.resolve({
            handle: "native-2",
            runId: "run-1",
            columns: 97,
            rows: 28,
          });
        }
        return Promise.reject(new Error("native preparation timed out"));
      }
      return Promise.resolve();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: -20,
      y: 10,
      top: 10,
      left: -20,
      right: 900,
      bottom: 650,
      width: 920,
      height: 640,
      toJSON: () => ({}),
    });
    let resizeRegistrations = 0;
    vi.stubGlobal("ResizeObserver", class {
      constructor() {
        resizeRegistrations += 1;
      }
      observe() {}
      disconnect() {}
    });

    const firstReady = vi.fn();
    const first = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        focusSignal={0}
        onReady={firstReady}
      />,
    );
    await waitFor(() => expect(attachFrames).toHaveLength(1));
    expect(attachFrames[0]).toEqual({
      x: 0,
      y: 10,
      width: 800,
      height: 590,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(releasePooledTransport).not.toHaveBeenCalled();
    expect(firstReady).not.toHaveBeenCalled();
    expect(resizeRegistrations).toBe(0);
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_focus",
      expect.anything(),
    );

    finishFirstAttach({
      handle: "native-1",
      runId: "run-1",
      columns: 97,
      rows: 28,
    });
    await waitFor(() => expect(firstReady).toHaveBeenCalledOnce());
    expect(releasePooledTransport).toHaveBeenCalledWith("session-1");
    expect(resizeRegistrations).toBe(1);
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_focus",
      expect.anything(),
    );
    first.unmount();

    const reopenedReady = vi.fn();
    const reopened = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={reopenedReady}
      />,
    );
    await waitFor(() => expect(reopenedReady).toHaveBeenCalledOnce());
    expect(attachFrames).toHaveLength(2);
    expect(attachFrames[1]).toEqual(attachFrames[0]);
    reopened.unmount();

    const requestsBeforeFailedAttach = vi.mocked(fetch).mock.calls.length;
    const fallback = render(<Terminal sessionId="session-1" />);
    await waitFor(() => {
      expect(fallback.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "Native terminal unavailable: native preparation timed out. Using compatibility renderer.",
      );
    });
    expect(fallback.getByTestId("terminal-host")).toBeVisible();
    expect(attachFrames).toHaveLength(3);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(requestsBeforeFailedAttach);
    expect(releasePooledTransport).toHaveBeenCalledTimes(2);
    expect(resizeRegistrations).toBe(2);
  });

  it("[overhaul-58] presents a viewer resized during preparation at the pane's live geometry", async () => {
    let finishAttach!: (status: {
      handle: string;
      runId: string;
      columns: number;
      rows: number;
    }) => void;
    const attach = new Promise<{
      handle: string;
      runId: string;
      columns: number;
      rows: number;
    }>((resolve) => {
      finishAttach = resolve;
    });
    let finishSetFrame!: (status: { columns: number; rows: number }) => void;
    const setFrame = new Promise<{ columns: number; rows: number }>((resolve) => {
      finishSetFrame = resolve;
    });
    const published: unknown[] = [];
    const appliedFrames: unknown[] = [];
    tauri.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (command === "native_terminal_attach") return attach;
      if (command === "native_terminal_reconcile_frame") {
        published.push(args);
        return Promise.resolve();
      }
      if (command === "native_terminal_set_frame") {
        appliedFrames.push(args?.frame);
        return setFrame;
      }
      return Promise.resolve();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );
    const measure = (width: number, height: number) => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({}),
      });
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
    };

    const ready = vi.fn();
    render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" onReady={ready} />,
    );
    await waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_attach", {
        runId: "run-1",
        viewerId: expect.any(String),
        frame: {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          viewportWidth: 800,
          viewportHeight: 600,
        },
      }),
    );

    // The Ticketry window is resized while preparation is still in flight.
    measure(640, 480);
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toEqual({
      runId: "run-1",
      frame: {
        x: 0,
        y: 0,
        width: 640,
        height: 480,
        viewportWidth: 640,
        viewportHeight: 480,
      },
    });
    expect(ready).not.toHaveBeenCalled();
    expect(releasePooledTransport).not.toHaveBeenCalled();

    // A further change lands too late for preparation to have adopted it.
    measure(500, 400);
    finishAttach({ handle: "native-1", runId: "run-1", columns: 80, rows: 30 });

    await waitFor(() => expect(appliedFrames).toHaveLength(1));
    expect(appliedFrames[0]).toEqual({
      x: 0,
      y: 0,
      width: 500,
      height: 400,
      viewportWidth: 500,
      viewportHeight: 400,
    });
    expect(ready).not.toHaveBeenCalled();
    expect(releasePooledTransport).not.toHaveBeenCalled();

    finishSetFrame({ columns: 62, rows: 25 });

    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(releasePooledTransport).toHaveBeenCalledWith("session-1");
  });

});
