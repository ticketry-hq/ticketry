import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { releasePooledTransport } from "../features/agents/terminal/internal/entryPool";
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

describe("native viewer attachment acceptance", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
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
    vi.stubEnv("VITE_WT_API_KEY", "native-terminal-secret");
    const lifecycle: string[] = [];
    let commitLease!: () => void;
    const leaseCommitted = new Promise<void>((resolve) => {
      commitLease = resolve;
    });
    vi.mocked(releasePooledTransport).mockImplementation(() => {
      lifecycle.push("release_fallback");
    });
    const requests: Array<{
      url: string;
      body: Record<string, string>;
      headers: Headers;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const operation = String(input).split("/").at(-1) ?? "request";
        lifecycle.push(operation);
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)) as Record<string, string>,
          headers: new Headers(init?.headers),
        });
        if (operation === "lease") await leaseCommitted;
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
    expect(requests[0].url).toContain("/api/terminals/viewers/lease");
    expect(requests[0].body).toMatchObject({
      agent_run_id: "run-1",
      transport: "desktop",
    });
    expect(requests[0].headers.get("x-api-key")).toBe("native-terminal-secret");
    expect(lifecycle.indexOf("native_terminal_attach")).toBeLessThan(
      lifecycle.indexOf("release_fallback"),
    );
    expect(lifecycle.indexOf("release_fallback")).toBeLessThan(
      lifecycle.indexOf("lease"),
    );
    expect(lifecycle.indexOf("lease")).toBeLessThan(
      lifecycle.indexOf("native_terminal_show"),
    );

    view.unmount();

    await waitFor(() => {
      expect(requests.some((request) =>
        request.url.includes("/api/terminals/viewers/lease/release"),
      )).toBe(true);
    });
    expect(requests.every((request) =>
      request.headers.get("x-api-key") === "native-terminal-secret",
    )).toBe(true);
    expect(tauri.invoke).toHaveBeenCalledWith("native_terminal_detach", {
      handle: "native-1",
    });
    expect(lifecycle.indexOf("native_terminal_detach")).toBeLessThan(
      lifecycle.indexOf("release"),
    );
  });

  it("keeps a slow first attachment hidden when its host loses presentation authority", async () => {
    let commitLease!: () => void;
    const leaseCommitted = new Promise<void>((resolve) => {
      commitLease = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/terminals/viewers/lease")) {
          await leaseCommitted;
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
    expect(tauri.invoke).toHaveBeenCalledWith(
      "native_terminal_attach",
      expect.anything(),
    );
  });

});
