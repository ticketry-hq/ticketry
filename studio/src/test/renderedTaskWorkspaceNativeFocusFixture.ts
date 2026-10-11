import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";
import { useTerminalStore, type SessionMeta } from "../features/agents/terminal";
import { rememberStudioWorkspaceTarget } from "../features/workspace-state/studioWorkspaceTarget";
import { installDeferredWorkspaceLaunches } from "./renderedTaskWorkspaceLaunchFixture";

/** Reuses the external native IPC and xterm DOM seams; workspace/pooling stay real. */
export function installWorkspaceNativeFocus() {
  const launches = installDeferredWorkspaceLaunches();
  localStorage.setItem("ticketry:terminal-renderer", "native");
  window.history.replaceState({}, "", "/?terminalRenderer=native");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, toJSON: () => ({}),
  });
  Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  let failNative = false;
  let keyboardFocused = false;
  let acceptsInput = false;
  let pendingShow: (() => void) | null = null;
  let deferShow = false;
  let deferOwnership = false;
  let pendingOwnership: (() => void) | null = null;
  let deferAttachment = false;
  let pendingAttachment: (() => void) | null = null;
  const prior = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const request = args as Record<string, unknown>;
    if (command === "native_terminal_available") return true as never;
    if (command === "native_terminal_attach") {
      if (deferAttachment) await new Promise<void>((resolve) => { pendingAttachment = resolve; });
      if (failNative) throw new Error("native attachment unavailable");
      return { handle: `native-${request.runId}`, runId: request.runId, columns: 100, rows: 30 } as never;
    }
    if (command === "native_terminal_show") {
      if (deferShow) await new Promise<void>((resolve) => { pendingShow = resolve; });
      return { handle: request.handle, columns: 100, rows: 30 } as never;
    }
    if (command === "native_terminal_set_frame") {
      return { handle: request.handle, columns: 100, rows: 30 } as never;
    }
    if (command === "native_terminal_set_webview_interaction") {
      if (deferOwnership && !request.webviewFocus) {
        await new Promise<void>((resolve) => { pendingOwnership = resolve; });
      }
      acceptsInput = !request.webviewFocus;
      if (!acceptsInput) keyboardFocused = false;
    }
    if (command === "native_terminal_focus") keyboardFocused = acceptsInput;
    return prior(command, args);
  });
  rememberStudioWorkspaceTarget("story-a", { kind: "details" });
  return {
    launches,
    calls: (command: string) => vi.mocked(invoke).mock.calls.filter(([name]) => name === command),
    nativeOwnsKeyboard: () => keyboardFocused,
    hasPendingShow: () => pendingShow !== null,
    delayPresentation: () => { deferShow = true; },
    finishPresentation: () => { deferShow = false; pendingShow?.(); pendingShow = null; },
    delayOwnership: () => { deferOwnership = true; },
    hasPendingOwnership: () => pendingOwnership !== null,
    finishOwnership: () => { deferOwnership = false; pendingOwnership?.(); pendingOwnership = null; },
    delayAttachment: () => { deferAttachment = true; },
    hasPendingAttachment: () => pendingAttachment !== null,
    finishAttachment: () => { deferAttachment = false; pendingAttachment?.(); pendingAttachment = null; },
    failAttachment: () => { failNative = true; },
  };
}

export function seedWorkspaceNativeRun(runId: string): SessionMeta {
  const session: SessionMeta = {
    sessionId: `session-${runId}`, agentRunId: runId, taskId: "story-a",
    projectId: "project-1", moduleId: "module-1", agent: "codex",
    status: "ready", transport: "ready", isPlanning: false,
    isInstant: false, initialPrompt: null,
  };
  useTerminalStore.setState({
    sessions: { [session.sessionId]: session },
    sessionByRun: { [runId]: session.sessionId },
  });
  return session;
}
