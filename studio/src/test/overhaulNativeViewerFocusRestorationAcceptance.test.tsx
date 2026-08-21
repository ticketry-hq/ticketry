import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeGhosttyTerminal } from "../features/agents/terminal/NativeGhosttyTerminal";
import { useModalStore } from "../app/modal/modalStore";
import { useTerminalForegroundStore } from "../features/agents/terminal/internal/foregroundStore";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { onNativeTerminalKeyboardEngaged } from "../runtime/nativeTerminalKeyboard";
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

const focusCalls = () =>
  tauri.invoke.mock.calls.filter(([command]) => command === "native_terminal_focus");

describe("native viewer focus restoration acceptance", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  // `native_terminal_focus` rejects a viewer whose presentation has not
  // committed, and the caller spends the signal either way. Focus therefore
  // must never be requested before the reveal resolves.
  it("holds a focus request until the viewer is presented, then focuses it", async () => {
    const pendingShow: { finish: (() => void) | null } = { finish: null };
    const keyboardEngaged = vi.fn();
    const stopKeyboardEngagementWatch =
      onNativeTerminalKeyboardEngaged(keyboardEngaged);
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
        return new Promise<void>((resolve) => {
          pendingShow.finish = () => resolve();
        });
      }
      return Promise.resolve();
    });

    const view = render(
      <NativeGhosttyTerminal
        sessionId="session-1"
        owner="studio"
        active
        focusSignal={1}
      />,
    );

    await waitFor(() => expect(pendingShow.finish).not.toBeNull());
    // Presentation has not committed yet, so no focus may be spent on it.
    expect(focusCalls()).toHaveLength(0);

    pendingShow.finish?.();
    await waitFor(() => expect(focusCalls()).toHaveLength(1));
    expect(keyboardEngaged).toHaveBeenCalledTimes(1);

    stopKeyboardEngagementWatch();
    view.unmount();
  });
});
