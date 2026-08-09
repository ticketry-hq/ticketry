import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { Terminal } from "../features/agents/terminal/Terminal";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";

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
    useTerminalStore.setState({
      sessions: {
        "session-1": {
          sessionId: "session-1",
          taskId: "task-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          ticketSeq: 1,
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
          columns: 80,
          rows: 24,
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
      return Promise.resolve();
    });
  });

  it("[overhaul-23] acquires outside viewer ownership before native attach and releases it on detach", async () => {
    vi.stubEnv("VITE_WT_API_KEY", "native-terminal-secret");
    const lifecycle: string[] = [];
    const requests: Array<{
      url: string;
      body: Record<string, string>;
      headers: Headers;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        lifecycle.push(String(input).split("/").at(-1) ?? "request");
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, string>,
          headers: new Headers(init?.headers),
        });
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    tauri.invoke.mockImplementation((command: string) => {
      lifecycle.push(command);
      if (command === "native_terminal_attach") {
        return Promise.resolve({
          handle: "native-1",
          runId: "run-1",
          columns: 80,
          rows: 24,
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

    await waitFor(() => expect(ready).toHaveBeenCalled());
    expect(requests[0].url).toContain("/api/terminals/viewers/lease");
    expect(requests[0].body).toMatchObject({
      agent_run_id: "run-1",
      transport: "desktop",
    });
    expect(requests[0].headers.get("x-api-key")).toBe("native-terminal-secret");
    expect(lifecycle.indexOf("lease")).toBeLessThan(
      lifecycle.indexOf("native_terminal_attach"),
    );

    view.unmount();

    await waitFor(() => {
      expect(requests.some((request) =>
        request.url.includes("/api/terminals/viewers/lease/release"),
      )).toBe(true);
    });
    expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
    expect(lifecycle.indexOf("native_terminal_detach")).toBeLessThan(
      lifecycle.indexOf("release"),
    );
  });

  it("releases ownership after an in-flight acquire commits during unmount", async () => {
    let commitAcquire!: () => void;
    const acquireCommitted = new Promise<void>((resolve) => {
      commitAcquire = resolve;
    });
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.endsWith("/api/terminals/viewers/lease")) {
          await acquireCommitted;
        }
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const view = render(
      <NativeGhosttyTerminal sessionId="session-1" owner="studio" />,
    );
    await waitFor(() => expect(requests).toHaveLength(1));

    view.unmount();
    expect(requests.some((url) => url.endsWith("/release"))).toBe(false);

    commitAcquire();
    await waitFor(() => {
      expect(requests.some((url) => url.endsWith("/release"))).toBe(true);
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "native_terminal_attach",
      expect.anything(),
    );
  });

  it("[overhaul-32] releases viewer ownership when the native attachment process exits", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    tauri.listen.mockImplementation(
      async (event: string, listener: (event: { payload: unknown }) => void) => {
        listeners.set(event, listener);
        return () => listeners.delete(event);
      },
    );
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
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
      expect(requests.some((url) => url.endsWith("/release"))).toBe(true);
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
          columns: 80,
          rows: 24,
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
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const firstUnavailable = vi.fn();
    const replacementUnavailable = vi.fn();
    const firstReady = vi.fn();
    const replacementReady = vi.fn();
    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={firstReady}
        onUnavailable={firstUnavailable}
      />,
    );
    await waitFor(() => expect(firstReady).toHaveBeenCalled());

    view.rerender(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        onReady={replacementReady}
        onUnavailable={replacementUnavailable}
      />,
    );
    await waitFor(() => expect(replacementReady).toHaveBeenCalled());
    const releasesBeforeStaleFailure = requests.filter((url) =>
      url.endsWith("/release"),
    ).length;

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
    expect(requests.filter((url) => url.endsWith("/release"))).toHaveLength(
      releasesBeforeStaleFailure,
    );
  });

  it("[overhaul-48] presents an available native Ghostty renderer for a live run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    const view = render(<Terminal sessionId="session-1" />);

    await waitFor(() => {
      expect(view.getByTestId("native-terminal-host")).toHaveAttribute(
        "data-terminal-renderer",
        "libghostty",
      );
    });
    expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_available");
    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_attach", {
        runId: "run-1",
      });
    });

    view.unmount();
  });
});
