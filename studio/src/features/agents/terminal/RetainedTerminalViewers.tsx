import { useEffect, useMemo, useState } from "react";

import { useClientStore } from "../../../state/clientStore";
import { Terminal } from "./Terminal";
import type { ForegroundOwner } from "./internal/foregroundStore";
import { useTerminalStore } from "./internal/sessionStore";

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
  const openedRunId =
    active && activeId ? sessions[activeId]?.agentRunId ?? null : null;
  const [retainedRunIds, setRetainedRunIds] = useState<string[]>([]);

  useEffect(() => {
    if (!openedRunId) return;
    setRetainedRunIds((current) =>
      current.includes(openedRunId) ? current : [...current, openedRunId],
    );
  }, [openedRunId]);

  const presentedRunIds = useMemo(
    () =>
      openedRunId && !retainedRunIds.includes(openedRunId)
        ? [...retainedRunIds, openedRunId]
        : retainedRunIds,
    [openedRunId, retainedRunIds],
  );

  return (
    <div className="relative h-full w-full">
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
