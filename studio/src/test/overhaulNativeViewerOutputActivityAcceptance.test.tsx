import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import {
  grantsEveryLease,
  installDesktopGraphQlRuntime,
} from "./desktopGraphQlRuntime";
import { documentOperationName } from "../graphql-foundation/typedDocument";

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

const nativeStatus = {
  handle: "native-1",
  runId: "run-1",
  columns: 100,
  rows: 30,
};

describe("native viewer output activity acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
    vi.useRealTimers();
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
      if (command === "native_terminal_available") return Promise.resolve(true);
      if (
        command === "native_terminal_attach" ||
        command === "native_terminal_set_frame" ||
        command === "native_terminal_show"
      ) {
        return Promise.resolve(nativeStatus);
      }
      return Promise.resolve();
    });
  });

  it("[overhaul-169] reports native terminal output through the shared activity operation once on attachment and never polls afterwards", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const host = vi.fn();
    vi.stubGlobal("fetch", host);
    const operations = installDesktopGraphQlRuntime();
    const reports = () =>
      operations.filter((operation) =>
        operation.operationName === "ObserveTerminalOutput",
      );

    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" active />,
    );

    // The native renderer owns its bytes, so Studio reports only the shared
    // observation and lets the backend decide whether output changed.
    await waitFor(() => expect(reports().length).toBeGreaterThan(0));
    expect(reports()[0].variables).toEqual({ agentRunId: "run-1" });
    // The observation is a Rust mutation; the retired host route is not a
    // fallback the viewer may reach for.
    expect(host).not.toHaveBeenCalled();

    // An attached viewer produces no further reports: Studio never sees the
    // native bytes, so a repeat would be an unconditional heartbeat — an
    // authenticated round trip and a capture-pane subprocess every tick, for
    // as long as the terminal is open. The backend's live-session sweep owns
    // ongoing observation.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports()).toHaveLength(1);

    // Navigating away retains the viewer without stopping its terminal, and
    // still adds no chatter.
    view.rerender(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" active={false} />,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports()).toHaveLength(1);

    view.unmount();
    await waitFor(() =>
      expect(
        operations.some((operation) => operation.operationName === "DeleteViewerLease"),
      ).toBe(true),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports()).toHaveLength(1);
  });

  it("keeps native rendering intact when activity reporting fails", async () => {
    installDesktopGraphQlRuntime(async (document, variables) => {
      if (documentOperationName(document) === "ObserveTerminalOutput") {
        throw new Error("backend unavailable");
      }
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

    await waitFor(() => expect(ready).toHaveBeenCalled());
    expect(tauri.invoke).toHaveBeenCalledWith(
      "native_terminal_show",
      expect.anything(),
    );
    expect(tauri.invoke).not.toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
    view.unmount();
  });
});
