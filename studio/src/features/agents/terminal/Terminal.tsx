import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import "xterm/css/xterm.css";

import {
  foregroundKey,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./internal/foregroundStore";
import {
  getEntry,
  registerPoolDriver,
  syncEntries,
} from "./internal/entryPool";
import { useTerminalStore } from "./internal/sessionStore";
import { useTerminalOwnership } from "./internal/useTerminalOwnership";
import { useTerminalPresentation } from "./internal/useTerminalPresentation";
import { registerTerminalFocus } from "./internal/terminalRegistry";
import { NativeGhosttyTerminal } from "./NativeGhosttyTerminal";
import { nativeGhosttyAvailable } from "./internal/nativeGhosttyAvailability";
import { reportNativeRenderFailure } from "./internal/nativeRenderRecovery";
import {
  nativeFailureIsHostNotVisible,
  nativeFailureIsViewerOwnershipStorage,
} from "./internal/nativeViewerFailure";
import { nativeViewerSessionIsLive } from "./internal/nativeViewerSessionLiveness";
import { ensureTerminalRunCreated } from "./internal/terminalRunCreation";

const OWNER_LABEL: Record<ForegroundOwner, string> = {
  studio: "the fallback workspace",
  drawer: "the issue drawer",
  panel: "the terminal panel",
};

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
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(() =>
    desktop ? null : false,
  );
  const [nativeFailure, setNativeFailure] = useState<{
    sessionId: string | null;
    reason: string;
  } | null>(null);
  const markNativeUnavailable = useCallback((reason: string) => {
    setNativeFailure({ sessionId, reason });
  }, [sessionId]);
  const nativeFailureReason =
    nativeFailure?.sessionId === sessionId ? nativeFailure.reason : null;

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void nativeGhosttyAvailable().then((available) => {
      if (active) setNativeAvailable(available);
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (!sessionId || !session) return;
    ensureTerminalRunCreated(sessionId, session);
  }, [session, sessionId]);

  // A native failure on a live desktop terminal is the only input to the
  // window-scoped recovery campaign. Capability absence, browser rendering and
  // ended sessions are supported fallback postures, not render failures.
  useEffect(() => {
    if (!desktop || !nativeAvailable || !nativeFailureReason) return;
    if (!session?.agentRunId || !nativeViewerSessionIsLive(session.status)) return;
    // A host with no visible frame before attachment never reaches the
    // renderer. Refreshing rebuilds the same layout, so the campaign would
    // escalate to its cap and reload forever without a renderer ever failing.
    if (nativeFailureIsHostNotVisible(nativeFailureReason)) return;
    // Lease persistence failures come from the Rust control plane. A WebView
    // reload cannot unlock its database and interrupts any in-flight Tauri
    // callbacks, so keep the working compatibility renderer instead.
    if (nativeFailureIsViewerOwnershipStorage(nativeFailureReason)) return;
    // Report the run, not just the reason, and hold the report for as long as
    // this surface shows the fallback: these inputs cannot change again once
    // the run has failed, so the coordinator is the only place that remembers
    // the run is still broken while other terminals recover natively.
    return reportNativeRenderFailure(session.agentRunId, nativeFailureReason);
  }, [
    desktop,
    nativeAvailable,
    nativeFailureReason,
    session?.agentRunId,
    session?.status,
  ]);

  if (desktop && (nativeAvailable === null || !session?.agentRunId)) {
    return (
      <div
        className="h-full w-full bg-pane-panel"
        data-testid="terminal-renderer-pending"
      />
    );
  }

  if (
    nativeAvailable &&
    !session?.isAppRun &&
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
    <XtermTerminal
      sessionId={active || session?.status === "connecting" ? sessionId : null}
      owner={owner}
      focusSignal={focusSignal}
    />
  );
  if (!nativeFailureReason) return fallback;
  return (
    <div className="relative h-full w-full">
      {fallback}
      <div
        role="status"
        data-testid="native-terminal-fallback-notice"
        className="pointer-events-none absolute bottom-2 right-2 max-w-[min(32rem,calc(100%-1rem))] border border-lifecycle-attention/40 bg-pane-bg/95 px-2 py-1 text-xs text-lifecycle-attention shadow"
      >
        Native terminal unavailable: {nativeFailureReason}. Using compatibility renderer.
      </div>
    </div>
  );
}

function XtermTerminal({
  sessionId,
  owner = "studio",
  focusSignal,
}: TerminalProps) {
  const sessions = useTerminalStore((state) => state.sessions);
  const registerHost = useTerminalForegroundStore((state) => state.registerHost);
  const unregisterHost = useTerminalForegroundStore((state) => state.unregisterHost);
  const handledFocusSignalRef = useRef(0);

  useEffect(() => syncEntries(sessions), [sessions]);

  const session = sessionId ? sessions[sessionId] ?? null : null;
  const key = session ? foregroundKey(session) : null;
  const { acquire, resolvedOwner } = useTerminalOwnership(key, owner);
  const visibleSessionId = session && resolvedOwner === owner ? sessionId : null;
  const { hostRef, mountedIdRef } = useTerminalPresentation({
    controlledFocus: focusSignal !== undefined,
    session: visibleSessionId ? session : null,
    sessionId: visibleSessionId,
  });

  useEffect(() => {
    registerHost(owner, hostRef.current);
    const releaseDriver = registerPoolDriver();
    return () => {
      unregisterHost(owner);
      releaseDriver();
    };
  }, [hostRef, owner, registerHost, unregisterHost]);

  useEffect(() => {
    if (!visibleSessionId) return;
    return registerTerminalFocus(visibleSessionId, () => {
      if (mountedIdRef.current !== visibleSessionId) return;
      getEntry(visibleSessionId)?.term.focus?.();
    });
  }, [mountedIdRef, visibleSessionId]);

  useEffect(() => {
    const pendingSignal =
      focusSignal !== undefined &&
      focusSignal !== 0 &&
      focusSignal !== handledFocusSignalRef.current;
    if (
      !pendingSignal ||
      !visibleSessionId ||
      mountedIdRef.current !== visibleSessionId
    ) {
      return;
    }

    const entry = getEntry(visibleSessionId);
    if (!entry) return;
    if (pendingSignal && focusSignal !== undefined) {
      handledFocusSignalRef.current = focusSignal;
    }
    entry.term.focus?.();
  }, [focusSignal, mountedIdRef, visibleSessionId]);

  const presentedElsewhere = session !== null && resolvedOwner !== owner;

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full bg-pane-bg" data-testid="terminal-host" />
      {presentedElsewhere && resolvedOwner ? (
        <TerminalOwnershipNotice
          owner={resolvedOwner}
          onReclaim={() => key && acquire(key, owner)}
        />
      ) : null}
    </div>
  );
}

function TerminalOwnershipNotice({
  owner,
  onReclaim,
}: {
  owner: ForegroundOwner;
  onReclaim: () => void;
}) {
  return (
    <div
      data-testid="terminal-presented-elsewhere"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pane-bg p-4 text-center text-sm text-text-muted"
    >
      <p>This terminal is open in {OWNER_LABEL[owner]}.</p>
      <button
        type="button"
        data-testid="terminal-reclaim"
        onClick={onReclaim}
        className="border border-pane-border px-3 py-1 text-sm text-text-primary hover:bg-pane-title"
      >
        View here
      </button>
    </div>
  );
}
