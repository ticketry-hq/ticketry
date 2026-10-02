import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NATIVE_TERMINAL_CHORD_EVENT } from "../app/navigation/nativeTerminalChords";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { useNativeViewerKeyboardOwnership } from "../features/agents/terminal/internal/useNativeViewerHostEffects";
import { useTerminalStore } from "../features/agents/terminal/internal/sessionStore";
import { useChangesWorkspace } from "../features/agents/worktrees";
import { useClientStore } from "../state/clientStore";
import {
  installDesktopGraphQlRuntime,
  terminalSessionReadExecutor,
} from "./desktopGraphQlRuntime";

const host = vi.hoisted(() => {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    listeners,
    listen: vi.fn(async (event: string, handler: (event: unknown) => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
    reportClose: (handle: string, runId: string) =>
      listeners.get(NATIVE_TERMINAL_CHORD_EVENT)?.({
        payload: { handle, runId, chord: "close-tab" },
      }),
  };
});

const terminalApi = vi.hoisted(() => ({ terminateTerminal: vi.fn() }));
const terminalReads = vi.hoisted(() => ({
  readTaskTerminalSessions: vi.fn(),
  readScratchTerminalSessions: vi.fn(),
  readTaskResumableTerminalSessions: vi.fn(),
  readScratchResumableTerminalSessions: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: host.listen }));
vi.mock("../features/agents/api/agentApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/agents/api/agentApi")>()),
  ...terminalApi,
}));

function useCloseHarness({ runId, handle }: { runId: string; handle: string }) {
  useGlobalKeymap();
  useNativeViewerKeyboardOwnership({
    runId,
    handle,
    presented: true,
    visible: true,
    modalOpen: false,
  });
}

describe("native terminal close shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host.listeners.clear();
    installDesktopGraphQlRuntime(terminalSessionReadExecutor(terminalReads));
    terminalReads.readTaskTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchTerminalSessions.mockResolvedValue([]);
    terminalReads.readTaskResumableTerminalSessions.mockResolvedValue([]);
    terminalReads.readScratchResumableTerminalSessions.mockResolvedValue([]);
    terminalApi.terminateTerminal.mockResolvedValue({
      agent_run_id: "run-current",
      terminated: true,
    });
    useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
    useChangesWorkspace.setState({ active: false });
    useClientStore.setState({
      selectedTaskId: "story-1",
      selectedModuleId: "module-1",
      sidebarVisible: false,
      editViewZone: "active-tab-body",
      editViewBodyEngaged: true,
      workspaces: {
        "story-1": { active: "terminal", activeDocId: null, closedDocIds: [] },
      },
      activeByTask: { "story-1": "session-current" },
    });
    useTerminalStore.setState({
      sessions: {
        "session-current": {
          sessionId: "session-current",
          taskId: "story-1",
          projectId: "project-1",
          moduleId: "module-1",
          agent: "codex",
          status: "ready",
          transport: "ready",
          isPlanning: false,
          isInstant: false,
          initialPrompt: null,
          agentRunId: "run-current",
        },
      },
      sessionByRun: { "run-current": "session-current" },
    });
  });

  it("[overhaul-402] closes the current run from Cmd+W in an engaged native terminal", async () => {
    const harness = renderHook(useCloseHarness, {
      initialProps: { handle: "native-old", runId: "run-current" },
    });
    await act(async () => {});

    harness.rerender({ handle: "native-current", runId: "run-current" });

    act(() => host.reportClose("native-old", "run-current"));
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    useTerminalStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        "session-other": {
          ...state.sessions["session-current"],
          sessionId: "session-other",
          agentRunId: "run-other",
        },
      },
      sessionByRun: {
        ...state.sessionByRun,
        "run-other": "session-other",
      },
    }));
    useClientStore.setState({
      activeByTask: { "story-1": "session-other" },
    });
    act(() => host.reportClose("native-current", "run-current"));
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();

    useClientStore.setState({
      activeByTask: { "story-1": "session-current" },
    });

    useChangesWorkspace.setState({ active: true });
    act(() => host.reportClose("native-current", "run-current"));
    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();
    useChangesWorkspace.setState({ active: false });

    act(() => host.reportClose("native-current", "run-current"));
    await waitFor(() =>
      expect(useTerminalStore.getState().sessionByRun["run-current"]).toBeUndefined(),
    );
    expect(terminalApi.terminateTerminal).toHaveBeenCalledWith("run-current");
    harness.unmount();
  });

  it("closes the current run from Cmd+W while typing in the WebView terminal", async () => {
    const terminalInput = render(<textarea aria-label="Terminal input" />)
      .getByRole("textbox", { name: "Terminal input" });
    const harness = renderHook(() => useGlobalKeymap());

    fireEvent.keyDown(terminalInput, { key: "w", metaKey: true });

    await waitFor(() =>
      expect(useTerminalStore.getState().sessionByRun["run-current"]).toBeUndefined(),
    );
    expect(terminalApi.terminateTerminal).toHaveBeenCalledWith("run-current");
    harness.unmount();
  });

  it("leaves the underlying run open while Changes owns the window", () => {
    useChangesWorkspace.setState({ active: true });
    const terminalInput = render(<textarea aria-label="Terminal input" />)
      .getByRole("textbox", { name: "Terminal input" });
    const harness = renderHook(() => useGlobalKeymap());

    fireEvent.keyDown(terminalInput, { key: "w", metaKey: true });

    expect(terminalApi.terminateTerminal).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessionByRun["run-current"])
      .toBe("session-current");
    harness.unmount();
    useChangesWorkspace.setState({ active: false });
  });
});
