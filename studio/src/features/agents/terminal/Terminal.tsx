import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import type { ForegroundOwner } from "./internal/foregroundStore";
import { LazyXtermTerminal } from "./xtermTerminalLoader";
import { useTerminalStore } from "./internal/sessionStore";
import { NativeGhosttyTerminal } from "./NativeGhosttyTerminal";
import { nativeGhosttyAvailable } from "./internal/nativeGhosttyAvailability";
import { nativeViewerSessionIsLive } from "./internal/nativeViewerSessionLiveness";
import { ensureTerminalRunCreated } from "./internal/terminalRunCreation";
import { currentTerminalRenderer } from "./internal/rendererSelection";

type TerminalProps = {
  sessionId: string | null;
  owner?: ForegroundOwner;
  /** Whether this terminal is the workspace's currently presented surface. */
  active?: boolean;
  /** A controlled request to focus the currently presented terminal. */
  focusSignal?: number;
  onNativeVisibilityPendingChange?: (runId: string, pending: boolean) => void;
};

/** Presents a pooled terminal session on one foreground surface. */
export function Terminal({
  sessionId,
  owner = "studio",
  focusSignal,
  active = true,
  onNativeVisibilityPendingChange,
}: TerminalProps) {
  const session = useTerminalStore((state) =>
    sessionId ? state.sessions[sessionId] ?? null : null,
  );
  const desktop = isTauri();
  // CODING-1486 — embedded native libghostty is the desktop product default
  // and xterm is its compatibility fallback; browser development renders with
  // xterm. Development builds may still force the other renderer for
  // diagnostics.
  const [rendererChoice] = useState(() => currentTerminalRenderer(desktop));
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(() =>
    desktop && rendererChoice === "native" ? null : false,
  );
  const [nativeFailure, setNativeFailure] = useState<{
    runId: string | null;
    reason: string;
  } | null>(null);
  const runId = session?.agentRunId ?? null;
  const markNativeUnavailable = useCallback((reason: string) => {
    setNativeFailure({ runId, reason });
  }, [runId]);
  const nativeFailureReason =
    nativeFailure?.runId === runId ? nativeFailure.reason : null;

  useEffect(() => {
    if (!desktop || rendererChoice !== "native") return;
    let active = true;
    void nativeGhosttyAvailable().then((available) => {
      if (active) setNativeAvailable(available);
    });
    return () => {
      active = false;
    };
  }, [desktop, rendererChoice]);

  useEffect(() => {
    if (!sessionId || !session) return;
    ensureTerminalRunCreated(sessionId, session);
  }, [session, sessionId]);

  if (session?.viewerAttachmentDeferred) {
    return (
      <div
        className="h-full w-full bg-inherit"
        data-testid="terminal-viewer-pending"
      />
    );
  }

  if (
    rendererChoice === "native" &&
    desktop &&
    (nativeAvailable === null || !session?.agentRunId)
  ) {
    return (
      <div
        className="h-full w-full bg-pane-panel"
        data-testid="terminal-renderer-pending"
      />
    );
  }

  if (
    rendererChoice === "native" &&
    nativeAvailable &&
    sessionId &&
    session?.agentRunId &&
    nativeViewerSessionIsLive(session.status) &&
    !nativeFailureReason
  ) {
    return (
      <NativeGhosttyTerminal
        sessionId={sessionId}
        owner={owner}
        focusSignal={focusSignal}
        active={active}
        onUnavailable={markNativeUnavailable}
        onVisibilityPendingChange={onNativeVisibilityPendingChange}
      />
    );
  }
  const fallback = (
    <LazyXtermTerminal
      sessionId={active || session?.status === "connecting" ? sessionId : null}
      owner={owner}
      focusSignal={focusSignal}
    />
  );
  // A native failure is local to this terminal: xterm takes over the same run
  // and tmux session, and the notice lasts only until its transport is ready.
  if (!nativeFailureReason || session?.transport === "ready") return fallback;
  return withFallbackNotice(fallback, nativeFailureReason, "Native terminal");
}

/** The compatibility renderer plus the reason the preferred one stepped aside. */
function withFallbackNotice(fallback: JSX.Element, reason: string, renderer: string) {
  return (
    <div className="relative h-full w-full">
      {fallback}
      <div
        role="status"
        data-testid="native-terminal-fallback-notice"
        className="pointer-events-none absolute bottom-2 right-2 max-w-[min(32rem,calc(100%-1rem))] border border-lifecycle-attention/40 bg-pane-bg/95 px-2 py-1 text-xs text-lifecycle-attention shadow"
      >
        {renderer} unavailable: {reason}. Using compatibility renderer.
      </div>
    </div>
  );
}
