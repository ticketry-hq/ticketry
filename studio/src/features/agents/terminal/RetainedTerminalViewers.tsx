import { useEffect, useMemo, useState } from "react";

import { useClientStore } from "../../../state/clientStore";
import { Terminal } from "./Terminal";
import type { ForegroundOwner } from "./internal/foregroundStore";
import {
  bucketOfMeta,
  useTerminalStore,
} from "./internal/sessionStore";

/** Keeps every opened run mounted while presenting only the selected session. */
export function RetainedTerminalViewers({
  bucket,
  owner,
  focusSignal,
  active,
  onNativeVisibilityPendingChange,
}: {
  bucket: string | null;
  owner: ForegroundOwner;
  focusSignal: number;
  active: boolean;
  onNativeVisibilityPendingChange?: (runId: string, pending: boolean) => void;
}) {
  const activeByTask = useClientStore((state) => state.activeByTask);
  const sessions = useTerminalStore((state) => state.sessions);
  const sessionByRun = useTerminalStore((state) => state.sessionByRun);
  const activeId = bucket ? activeByTask[bucket] : undefined;
  const openedPendingSessionIds = useMemo(
    () =>
      bucket
        ? Object.values(sessions)
            .filter(
              (session) =>
                session.status === "connecting" &&
                !session.agentRunId &&
                bucketOfMeta(session) === bucket,
            )
            .map((session) => session.sessionId)
        : [],
    [bucket, sessions],
  );
  const [retainedPendingSessionIds, setRetainedPendingSessionIds] = useState<
    string[]
  >([]);
  const openedRunId =
    active && activeId ? sessions[activeId]?.agentRunId ?? null : null;
  const [retainedRunIds, setRetainedRunIds] = useState<string[]>([]);

  useEffect(() => {
    setRetainedPendingSessionIds((current) => {
      const retained = current.filter((sessionId) => {
        const session = sessions[sessionId];
        return (
          session?.status === "connecting" && !session.agentRunId
        );
      });
      for (const sessionId of openedPendingSessionIds) {
        if (!retained.includes(sessionId)) retained.push(sessionId);
      }
      return retained;
    });
  }, [openedPendingSessionIds, sessions]);

  const acknowledgedPendingRunIds = retainedPendingSessionIds.flatMap(
    (sessionId) => {
      const runId = sessions[sessionId]?.agentRunId;
      return runId ? [runId] : [];
    },
  );

  useEffect(() => {
    const openedRunIds = [
      ...(openedRunId ? [openedRunId] : []),
      ...acknowledgedPendingRunIds,
    ];
    if (!openedRunIds.length) return;
    setRetainedRunIds((current) =>
      openedRunIds.every((runId) => current.includes(runId))
        ? current
        : [...new Set([...current, ...openedRunIds])],
    );
  }, [acknowledgedPendingRunIds, openedRunId]);

  const presentedRunIds = useMemo(
    () => [
      ...new Set([
        ...retainedRunIds,
        ...(openedRunId ? [openedRunId] : []),
        ...acknowledgedPendingRunIds,
      ]),
    ],
    [acknowledgedPendingRunIds, openedRunId, retainedRunIds],
  );

  return (
    <div className="relative h-full w-full">
      {[...new Set([...retainedPendingSessionIds, ...openedPendingSessionIds])]
        .filter((sessionId) => !sessions[sessionId]?.agentRunId)
        .map((sessionId) => {
          const presented = active && sessionId === activeId;
          return (
            <div
              key={sessionId}
              data-testid="retained-terminal-viewer"
              data-terminal-session-id={sessionId}
              className={
                presented
                  ? "absolute inset-0"
                  : "absolute inset-0 invisible pointer-events-none"
              }
            >
              <Terminal
                sessionId={sessionId}
                owner={owner}
                focusSignal={presented ? focusSignal : 0}
                active
                onNativeVisibilityPendingChange={onNativeVisibilityPendingChange}
              />
            </div>
          );
        })}
      {presentedRunIds.map((runId) => {
        const sessionId = sessionByRun[runId];
        if (!sessionId || !sessions[sessionId]) return null;
        const presented = active && sessionId === activeId;
        return (
          <div
            key={runId}
            data-testid="retained-terminal-viewer"
            data-terminal-run-id={runId}
            className={
              presented
                ? "absolute inset-0"
                : "absolute inset-0 invisible pointer-events-none"
            }
          >
            <Terminal
              sessionId={sessionId}
              owner={owner}
              focusSignal={presented ? focusSignal : 0}
              active={presented}
              onNativeVisibilityPendingChange={onNativeVisibilityPendingChange}
            />
          </div>
        );
      })}
    </div>
  );
}
