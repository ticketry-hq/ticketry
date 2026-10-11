import { useEffect, type MutableRefObject } from "react";
import { bucketOfMeta, type ForegroundOwner, type SessionMeta } from "../../agents/terminal";
import { rememberStudioWorkspaceTarget } from "../../workspace-state/studioWorkspaceTarget";

/** A transient intent, never a copy of terminal records or active selection. */
export interface PendingTerminalTarget {
  sessionId: string;
  isCurrent: () => boolean;
}

export function resolveOriginatingSession(
  sessions: Readonly<Record<string, SessionMeta>>,
  sessionId: string,
): SessionMeta | undefined {
  return sessions[sessionId] ?? Object.values(sessions).find(
    (session) => session.initialSessionId === sessionId,
  );
}

export function useRememberPendingTerminalTarget({
  bucket,
  owner,
  sessions,
  rememberPendingTerminalRef,
}: {
  bucket: string | null;
  owner: ForegroundOwner;
  sessions: Readonly<Record<string, SessionMeta>>;
  rememberPendingTerminalRef: MutableRefObject<PendingTerminalTarget | null>;
}): void {
  useEffect(() => {
    const pending = rememberPendingTerminalRef.current;
    if (!pending) return;
    if (!pending.isCurrent()) {
      rememberPendingTerminalRef.current = null;
      return;
    }
    if (owner !== "studio" || !bucket) return;
    const session = resolveOriginatingSession(sessions, pending.sessionId);
    if (!session?.agentRunId || bucketOfMeta(session) !== bucket) return;
    rememberPendingTerminalRef.current = null;
    rememberStudioWorkspaceTarget(bucket, {
      kind: "terminal", agentRunId: session.agentRunId,
    });
  }, [bucket, owner, sessions, rememberPendingTerminalRef]);
}
