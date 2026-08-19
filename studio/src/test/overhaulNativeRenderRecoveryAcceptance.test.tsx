import { render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Terminal } from "../features/agents/terminal/Terminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import {
  INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS,
  configureNativeRenderRecovery,
  nativeRenderRecoveryDelayMs,
  nativeRenderRecoveryPending,
  resetNativeRenderRecovery,
} from "../features/agents/terminal/internal/nativeRenderRecovery";
import {
  readNativeRenderRecoveryAttempt,
  writeNativeRenderRecoveryAttempt,
} from "../features/agents/terminal/internal/nativeRenderRecoveryStore";
import {
  useTerminalStore,
  type SessionMeta,
  type SessionStatus,
} from "../features/agents/terminal/internal/sessionStore";
import { useClientStore } from "../state/clientStore";

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

/** Longer than the initial recovery delay, so a scheduled refresh must fire. */
const PAST_INITIAL_DELAY_MS = INITIAL_NATIVE_RENDER_RECOVERY_DELAY_MS + 200;

/**
 * Remainder of the second attempt's wait, once {@link PAST_INITIAL_DELAY_MS}
 * has already gone by without a refresh.
 */
const REST_OF_SECOND_DELAY_MS =
  nativeRenderRecoveryDelayMs(1) - PAST_INITIAL_DELAY_MS + 200;

/**
 * Advances the injected clock. The suite runs on fake timers, so a recovery
 * delay costs no wall-clock time and no assertion races a congested event loop.
 */
async function elapse(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
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
    transport: "ready",
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

function nativeStatus(handle: string, runId: string) {
  return { handle, runId, columns: 100, rows: 30 };
}

describe("native render recovery acceptance", () => {
  const reload = vi.fn();
  let restore: () => void;

  beforeEach(() => {
    vi.resetAllMocks();
    // `shouldAdvanceTime` keeps Testing Library's own polling alive — it does
    // not detect Vitest's fake timers — while every recovery delay in this
    // suite is stepped explicitly through `elapse`.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runtime.desktop = true;
    runtime.nativeAvailable = true;
    reload.mockReset();
    restore = configureNativeRenderRecovery({ reload });
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
    resetNativeRenderRecovery();
    restore();
    vi.useRealTimers();
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

  it("[overhaul-113] keeps the compatibility renderer and refreshes Studio once after a native render failure", async () => {
    seed(session("session-a", "run-a"));
    failingNativeTerminal("terminal attachment failed");

    const view = render(<Terminal sessionId="session-a" active />);

    await waitFor(() => {
      expect(view.getByTestId("native-terminal-fallback-notice")).toHaveTextContent(
        "Native terminal unavailable: terminal attachment failed. Using compatibility renderer.",
      );
    });
    expect(view.getByTestId("terminal-host")).toBeVisible();
    expect(reload).not.toHaveBeenCalled();

    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
    expect(view.getByTestId("terminal-host")).toBeVisible();
  });

  it("requests one refresh for repeated failures across competing and retained hosts", async () => {
    seed(session("session-b", "run-b"));
    failingNativeTerminal("terminal attachment failed");

    const workspace = render(<Terminal sessionId="session-b" active />);
    const panel = render(<Terminal sessionId="session-b" owner="panel" active />);
    await waitFor(() => {
      expect(
        within(workspace.container).getByTestId("native-terminal-fallback-notice"),
      ).toBeInTheDocument();
      expect(
        within(panel.container).getByTestId("native-terminal-fallback-notice"),
      ).toBeInTheDocument();
    });

    workspace.unmount();
    const remounted = render(<Terminal sessionId="session-b" active />);
    await waitFor(() => {
      expect(
        within(remounted.container).getByTestId("native-terminal-fallback-notice"),
      ).toBeInTheDocument();
    });

    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("cancels the pending refresh once a native viewer presents a non-empty grid", async () => {
    seed(session("session-c", "run-c"), session("session-d", "run-d"));
    failingNativeTerminal("terminal attachment failed");

    const failed = render(<Terminal sessionId="session-c" active />);
    await waitFor(() => {
      expect(failed.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    expect(nativeRenderRecoveryPending()).toBe(true);
    failed.unmount();

    workingNativeTerminal("native-d", "run-d");
    const recovered = render(<Terminal sessionId="session-d" active />);
    await waitFor(() => {
      expect(recovered.getByTestId("native-terminal-host")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(runtime.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-d" }),
      );
    });

    expect(nativeRenderRecoveryPending()).toBe(false);
    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();

    // A later, unrelated incident is a fresh campaign at the initial delay.
    recovered.unmount();
    seed(session("session-e", "run-e"));
    failingNativeTerminal("native resize failed");
    const relapsed = render(<Terminal sessionId="session-e" active />);
    await waitFor(() => {
      expect(relapsed.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("[overhaul-116] keeps recovering a broken terminal while another terminal renders natively", async () => {
    seed(session("session-k", "run-k"), session("session-l", "run-l"));
    // run-k's attachment fails; every other run attaches and presents normally.
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
    await waitFor(() => {
      expect(broken.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    expect(nativeRenderRecoveryPending()).toBe(true);

    // A second, healthy terminal presents a non-empty grid. It recovered its
    // own run, not run-k's, so run-k must not be stranded on the fallback.
    const healthy = render(<Terminal sessionId="session-l" owner="panel" active />);
    await waitFor(() => {
      expect(runtime.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-run-l" }),
      );
    });
    expect(
      within(healthy.container).queryByTestId("native-terminal-fallback-notice"),
    ).toBeNull();
    expect(
      within(broken.container).getByTestId("native-terminal-fallback-notice"),
    ).toBeInTheDocument();

    expect(nativeRenderRecoveryPending()).toBe(true);
    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
    // The consumed attempt stands: the healthy presentation must not reset the
    // backoff and hand the next document another 500 millisecond reload.
    expect(readNativeRenderRecoveryAttempt()).toBe(1);
  });

  it("[overhaul-115] waits longer for each refresh while native rendering keeps failing, and every refresh leaves the durable run restorable", async () => {
    // The document under test is the one the first refresh produced, so its
    // campaign is one attempt in and owes a one second wait, not 500 ms.
    writeNativeRenderRecoveryAttempt(1);
    seed(session("session-h", "run-h"), session("session-i", "run-i"));
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    failingNativeTerminal("terminal attachment failed");
    const failedAgain = render(<Terminal sessionId="session-h" active />);
    await waitFor(() => {
      expect(
        failedAgain.getByTestId("native-terminal-fallback-notice"),
      ).toBeInTheDocument();
    });
    expect(failedAgain.getByTestId("terminal-host")).toBeVisible();

    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
    await elapse(REST_OF_SECOND_DELAY_MS);
    expect(reload).toHaveBeenCalledOnce();
    expect(readNativeRenderRecoveryAttempt()).toBe(2);
    failedAgain.unmount();

    // The refresh is an ordinary page unload: the temporary viewer of a
    // durable session is detached and its lease released exactly once.
    workingNativeTerminal("native-i", "run-i");
    const attached = render(<Terminal sessionId="session-i" active />);
    await waitFor(() => {
      expect(runtime.invoke).toHaveBeenCalledWith(
        "native_terminal_show",
        expect.objectContaining({ handle: "native-i" }),
      );
    });
    const claims = useTerminalForegroundStore.getState().claims;
    requests.length = 0;
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("beforeunload"));
    await waitFor(() => {
      expect(requests.filter((url) => url.endsWith("/release"))).toHaveLength(1);
    });
    expect(runtime.invoke.mock.calls.filter(([command]) =>
      command === "native_terminal_detach"
    )).toHaveLength(1);
    attached.unmount();

    // The recovered document restores the same durable run, under the same
    // foreground owner, and its native presentation ends the campaign.
    const restored = render(<Terminal sessionId="session-i" active />);
    await waitFor(() => {
      expect(restored.getByTestId("native-terminal-host")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(runtime.invoke).toHaveBeenCalledWith(
        "native_terminal_attach",
        expect.objectContaining({ runId: "run-i" }),
      );
    });
    expect(useTerminalStore.getState().sessionByRun["run-i"]).toBe("session-i");
    expect(useTerminalForegroundStore.getState().claims).toEqual(claims);
    await waitFor(() => expect(readNativeRenderRecoveryAttempt()).toBe(0));

    // With the campaign cleared, the next unrelated incident waits 500 ms.
    restored.unmount();
    seed(session("session-j", "run-j"));
    failingNativeTerminal("native resize failed");
    const relapsed = render(<Terminal sessionId="session-j" active />);
    await waitFor(() => {
      expect(relapsed.getByTestId("native-terminal-fallback-notice")).toBeInTheDocument();
    });
    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("leaves browser rendering and absent native capability without a refresh", async () => {
    runtime.desktop = false;
    runtime.nativeAvailable = false;
    seed(session("session-f", "run-f"));

    const browser = render(<Terminal sessionId="session-f" active />);
    await waitFor(() => expect(browser.getByTestId("terminal-host")).toBeVisible());
    browser.unmount();

    runtime.desktop = true;
    const unsupported = render(<Terminal sessionId="session-f" active />);
    await waitFor(() => expect(unsupported.getByTestId("terminal-host")).toBeVisible());

    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });

  it("leaves a live host with no visible frame before attachment without a refresh", async () => {
    // The host clips to zero area against the viewport — a drawer or panel
    // mid-transition, or a window resized until the host leaves the viewport.
    // Attachment never reaches the renderer, and a refresh would rebuild the
    // same layout, so this must not book one.
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

    expect(nativeRenderRecoveryPending()).toBe(false);
    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
    expect(readNativeRenderRecoveryAttempt()).toBe(0);
  });

  it("leaves ended sessions, inactive viewers and dismissal without a refresh", async () => {
    seed(session("session-g", "run-g", "exited"));
    failingNativeTerminal("terminal attachment failed");

    const ended = render(<Terminal sessionId="session-g" active={false} />);
    await waitFor(() => expect(ended.getByTestId("terminal-host")).toBeInTheDocument());
    ended.rerender(<Terminal sessionId={null} />);

    await elapse(PAST_INITIAL_DELAY_MS);
    expect(reload).not.toHaveBeenCalled();
  });
});
