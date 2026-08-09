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
import {
  NativeGhosttyTerminal,
  nativeGhosttyAvailable,
} from "./NativeGhosttyTerminal";

const OWNER_LABEL: Record<ForegroundOwner, string> = {
  studio: "the fallback workspace",
  drawer: "the issue drawer",
};

type TerminalProps = {
  sessionId: string | null;
  owner?: ForegroundOwner;
  /** A controlled request to focus the currently presented terminal. */
  focusSignal?: number;
};

/** Presents a pooled terminal session on one foreground surface. */
export function Terminal({ sessionId, owner = "studio", focusSignal }: TerminalProps) {
  const session = useTerminalStore((state) =>
    sessionId ? state.sessions[sessionId] ?? null : null,
  );
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [nativeFailedSessionId, setNativeFailedSessionId] = useState<string | null>(
    null,
  );
  const markNativeUnavailable = useCallback(() => {
    setNativeFailedSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    void nativeGhosttyAvailable().then((available) => {
      if (active) setNativeAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

  if (
    nativeAvailable &&
    sessionId &&
    session?.agentRunId &&
    nativeFailedSessionId !== sessionId
  ) {
    return (
      <NativeGhosttyTerminal
        sessionId={sessionId}
        owner={owner}
        focusSignal={focusSignal}
        onUnavailable={markNativeUnavailable}
      />
    );
  }
  return <XtermTerminal sessionId={sessionId} owner={owner} focusSignal={focusSignal} />;
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
        className="rounded-md border border-pane-border px-3 py-1 text-sm text-text-primary hover:bg-pane-title"
      >
        View here
      </button>
    </div>
  );
}
