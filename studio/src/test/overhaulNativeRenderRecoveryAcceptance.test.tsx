import { render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Terminal } from "../features/agents/terminal/Terminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import {
  useTerminalStore,
  type SessionMeta,
  type SessionStatus,
} from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime } from "./desktopGraphQlRuntime";

const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  desktop: true,
  nativeAvailable: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: runtime.invoke,
  isTauri: () => runtime.desktop,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: runtime.listen,
}));

vi.mock("../features/agents/terminal/internal/entryPool", () => ({
  getEntry: () => null,
  registerPoolDriver: () => () => {},
  releasePooledTransport: vi.fn(),
  syncEntries: vi.fn(),
}));

vi.mock("../features/agents/terminal/internal/nativeGhosttyAvailability", () => ({
  nativeGhosttyAvailable: () => Promise.resolve(runtime.nativeAvailable),
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function session(
  sessionId: string,
  runId: string,
  status: SessionStatus = "ready",
): SessionMeta {
  return {
    sessionId,
    taskId: "task-1",
    projectId: "project-1",
    moduleId: "module-1",
    agent: "codex",
    status,
    // A native-rendered session never sees an xterm ready frame; the transport
    // only turns ready once the compatibility renderer attaches.
    transport: "connecting",
    isPlanning: false,
    isInstant: false,
    initialPrompt: null,
    agentRunId: runId,
  };
}

function seed(...seeded: SessionMeta[]): void {
  useTerminalStore.setState({
    sessions: Object.fromEntries(
      seeded.map((entry) => [entry.sessionId, entry]),
    ),
    sessionByRun: Object.fromEntries(
      seeded.map((entry) => [entry.agentRunId as string, entry.sessionId]),
    ),
  });
}

/** The xterm client's ready frame for a session the native renderer gave up. */
function xtermConnected(sessionId: string): void {
  useTerminalStore.getState().setReconnected(sessionId);
}

function nativeStatus(handle: string, runId: string) {
  return { handle, runId, columns: 100, rows: 30 };
}

describe("native render recovery acceptance", () => {
  const reload = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/?terminalRenderer=native");
    vi.resetAllMocks();
    // Unmount teardown detaches through `invoke` after a case has ended.
    runtime.invoke.mockResolvedValue(undefined);
    localStorage.setItem("ticketry:terminal-renderer", "native");
    installDesktopGraphQlRuntime();
    runtime.desktop = true;
    runtime.nativeAvailable = true;
    reload.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload, href: "http://localhost/" },
    });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
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
    runtime.listen.mockResolvedValue(() => {});
    window.sessionStorage.clear();
  });

  afterEach(() => {
    useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  });

  function failingNativeTerminal(reason: string): void {
    runtime.invoke.mockImplementation((command: string) => {
      if (command === "native_terminal_attach") {
        return Promise.reject(new Error(reason));
      }
      return Promise.resolve();
    });
  }

  function workingNativeTerminal(handle: string, runId: string): void {
    runtime.invoke.mockImplementation((command: string) => {
      if (
        command === "native_terminal_attach" ||
        command === "native_terminal_show" ||
        command === "native_terminal_set_frame"
      ) {
        return Promise.resolve(nativeStatus(handle, runId));
      }
      return Promise.resolve();
    });
  }

  function fallbackRecord() {
    return warn.mock.calls.find(
      ([message]) => message === "[terminal-viewer] native renderer failed; xterm takes over",
    );
  }

  it("[overhaul-113] lets xterm take over the same run after a native render failure, drops the notice once it connects, and never refreshes Studio", async () => {
    seed(session("session-a", "run-a"));
    failingNativeTerminal("terminal attachment failed");

    const view = render(<Terminal sessionId="session-a" active />);

    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "Native terminal unavailable: terminal attachment failed. Using compatibility renderer.",
      );
    });
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());
    expect(view.queryByTestId("native-terminal-host")).toBeNull();

    // Operators get the origin and both identities; the surface gets nothing.
    expect(fallbackRecord()?.[1]).toMatchObject({
      runId: "run-a",
      sessionId: "session-a",
      origin: "attach",
      reason: "terminal attachment failed",
    });
    expect(warn.mock.calls.filter(([message]) =>
      message === "[terminal-viewer] native renderer failed; xterm takes over"
    )).toHaveLength(1);

    xtermConnected("session-a");
    await waitFor(() => {
      expect(view.queryByTestId("native-terminal-fallback-notice")).toBeNull();
    });
    expect(view.getByTestId("terminal-host")).toBeVisible();
    expect(useTerminalStore.getState().sessionByRun["run-a"]).toBe("session-a");
    expect(useTerminalStore.getState().sessions["session-a"]?.agentRunId).toBe("run-a");
    expect(reload).not.toHaveBeenCalled();
  });

  it("records the native handle when attachment returns an unusable grid", async () => {
    seed(session("session-grid", "run-grid"));
    runtime.invoke.mockImplementation((command: string) => Promise.resolve(
      command === "native_terminal_attach"
        ? { ...nativeStatus("native-grid", "run-grid"), columns: 0 }
        : undefined,
    ));
    const view = render(<Terminal sessionId="session-grid" active />);
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());
    expect(fallbackRecord()?.[1]).toMatchObject({
      runId: "run-grid",
      sessionId: "session-grid",
      origin: "attach",
      reason: "native terminal renderer returned an empty grid",
      handle: "native-grid",
    });
  });

  it("keeps falling back when the diagnostics write itself fails", async () => {
    vi.mocked(console.error).mockImplementation(() => {
      throw new Error("console bridge unavailable");
    });
    warn.mockImplementation(() => {
      throw new Error("console bridge unavailable");
    });
    seed(session("session-w", "run-w"));
    failingNativeTerminal("terminal attachment failed");

    const view = render(<Terminal sessionId="session-w" active />);
    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows the terminal-scoped failure state, not a refresh, when both renderers fail", async () => {
    seed(session("session-b", "run-b"));
    failingNativeTerminal("terminal attachment failed");

    const view = render(<Terminal sessionId="session-b" active />);
    await waitFor(() => {
      expect(view.getByTestId("terminal-host")).toBeVisible();
    });

    // The xterm client's transport dies for good.
    useTerminalStore.getState().lostConnection("session-b");
    await waitFor(() => {
      expect(useTerminalStore.getState().sessions["session-b"]?.status).toBe("exited");
    });
    expect(view.getByTestId("terminal-host")).toBeInTheDocument();
    expect(view.queryByTestId("native-terminal-host")).toBeNull();
    expect(useTerminalStore.getState().sessionByRun["run-b"]).toBe("session-b");
    expect(reload).not.toHaveBeenCalled();
  });

  it("preserves run and session identities across switching, closing, reopening and restoration of a fallen-back terminal", async () => {
    seed(session("session-h", "run-h"), session("session-i", "run-i"));
    failingNativeTerminal("terminal attachment failed");

    const view = render(<Terminal sessionId="session-h" active />);
    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    xtermConnected("session-h");
    await waitFor(() => {
      expect(view.queryByTestId("native-terminal-fallback-notice")).toBeNull();
    });

    // Later switch to another terminal and back.
    view.rerender(<Terminal sessionId="session-i" active />);
    view.rerender(<Terminal sessionId="session-h" active />);
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());
    expect(view.queryByTestId("native-terminal-fallback-notice")).toBeNull();

    // Close and reopen the surface.
    view.rerender(<Terminal sessionId={null} />);
    view.rerender(<Terminal sessionId="session-h" active />);
    await waitFor(() => expect(view.getByTestId("terminal-host")).toBeVisible());

    // Restoration: a fresh mount of the same durable session.
    view.unmount();
    const restored = render(<Terminal sessionId="session-h" active />);
    await waitFor(() => expect(restored.getByTestId("terminal-host")).toBeVisible());
    expect(restored.queryByTestId("native-terminal-host")).toBeNull();

    // One native attempt for the run, one xterm takeover, no new run or session.
    expect(runtime.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_attach"
    )).toHaveLength(1);
    expect(useTerminalStore.getState().sessionByRun).toEqual({
      "run-h": "session-h",
      "run-i": "session-i",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("[overhaul-116] keeps a native failure local to its terminal while another live run renders natively", async () => {
    seed(session("session-k", "run-k"), session("session-l", "run-l"));
    runtime.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        const runId = String(args?.runId ?? "");
        if (command === "native_terminal_attach") {
          return runId === "run-k"
            ? Promise.reject(new Error("terminal attachment failed"))
            : Promise.resolve(nativeStatus(`native-${runId}`, runId));
        }
        if (
          command === "native_terminal_show" ||
          command === "native_terminal_set_frame"
        ) {
          return Promise.resolve(
            nativeStatus(String(args?.handle ?? ""), "run-l"),
          );
        }
        return Promise.resolve();
      },
    );

    const broken = render(<Terminal sessionId="session-k" active />);
    const healthy = render(<Terminal sessionId="session-l" owner="panel" active />);
    await waitFor(() => {
      expect(
        within(broken.container).getByTestId("terminal-host"),
      ).toBeVisible();
      expect(runtime.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-run-l" }),
      );
    });
    expect(within(healthy.container).getByTestId("native-terminal-host")).toBeInTheDocument();
    expect(within(healthy.container).queryByTestId("native-terminal-fallback-notice")).toBeNull();
    expect(within(broken.container).queryByTestId("native-terminal-host")).toBeNull();

    xtermConnected("session-k");
    await waitFor(() => {
      expect(
        within(broken.container).queryByTestId("native-terminal-fallback-notice"),
      ).toBeNull();
    });
    expect(useTerminalStore.getState().sessionByRun).toEqual({
      "run-k": "session-k",
      "run-l": "session-l",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves browser rendering and absent native capability on xterm without a notice or refresh", async () => {
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    seed(session("session-f", "run-f"));

    const browser = render(<Terminal sessionId="session-f" active />);
    await waitFor(() => expect(browser.getByTestId("terminal-host")).toBeVisible());
    expect(browser.queryByTestId("native-terminal-fallback-notice")).toBeNull();
    browser.unmount();

    runtime.desktop = true;
    const unsupported = render(<Terminal sessionId="session-f" active />);
    await waitFor(() => expect(unsupported.getByTestId("terminal-host")).toBeVisible());
    expect(unsupported.queryByTestId("native-terminal-fallback-notice")).toBeNull();
    expect(fallbackRecord()).toBeUndefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back for a live host with no visible frame before attachment without a refresh", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    seed(session("session-k", "run-k"));
    workingNativeTerminal("native-k", "run-k");

    const clipped = render(<Terminal sessionId="session-k" active />);
    await waitFor(() => {
      expect(clipped.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "native terminal host has no visible frame",
      );
    });
    expect(clipped.getByTestId("terminal-host")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("[overhaul-161] keeps the compatibility renderer without refreshing on viewer ownership storage failure", async () => {
    seed(session("session-locked", "run-locked"));
    failingNativeTerminal(
      "viewer ownership storage failed: Query Error: error returned from database: (code: 5) database is locked",
    );

    const locked = render(<Terminal sessionId="session-locked" active />);
    await waitFor(() => {
      expect(locked.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "viewer ownership storage failed",
      );
    });
    expect(locked.getByTestId("terminal-host")).toBeVisible();
    expect(fallbackRecord()?.[1]).toMatchObject({
      runId: "run-locked",
      sessionId: "session-locked",
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves ended sessions and inactive viewers on xterm without a native attempt", async () => {
    seed(session("session-g", "run-g", "exited"));
    failingNativeTerminal("terminal attachment failed");

    const ended = render(<Terminal sessionId="session-g" active={false} />);
    await waitFor(() => expect(ended.getByTestId("terminal-host")).toBeInTheDocument());
    ended.rerender(<Terminal sessionId={null} />);

    expect(runtime.invoke).not.toHaveBeenCalledWith(
      "native_terminal_attach",
      expect.anything(),
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
