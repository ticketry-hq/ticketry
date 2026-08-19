import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
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

  it("[overhaul-142] reports native terminal output through the shared activity operation once on attachment and never polls afterwards", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv("VITE_WT_API_KEY", "native-terminal-secret");
    const requests: Array<{ url: string; body: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, string>,
        });
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const reports = () =>
      requests.filter((request) =>
        request.url.endsWith("/api/terminals/viewers/output"),
      );

    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" active />,
    );

    // The native renderer owns its bytes, so Studio reports only the shared
    // observation and lets the backend decide whether output changed.
    await waitFor(() => expect(reports().length).toBeGreaterThan(0));
    expect(reports()[0].body).toEqual({ agent_run_id: "run-1" });

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
        requests.some((request) => request.url.endsWith("/lease/release")),
      ).toBe(true),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports()).toHaveLength(1);
  });

  it("keeps native rendering intact when activity reporting fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/terminals/viewers/output")) {
          throw new Error("backend unavailable");
        }
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
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
