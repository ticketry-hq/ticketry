import { useEffect } from "react";

import { Terminal, useTerminalStore } from "../agents/terminal";
import { useStudioStore } from "../projects";
import { useTerminalPanelStore } from "../terminal-panel";
import { useModuleAppRun } from "./useModuleAppRun";

export function AppRunPanel({ moduleId }: { moduleId: string }) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const focusSignal = useTerminalPanelStore((state) => state.focusSignal);
  const run = useModuleAppRun(moduleId);
  const sessionId = useTerminalStore((state) =>
    run.runId ? state.sessionByRun[run.runId] ?? null : null,
  );
  const openAppRunSession = useTerminalStore((state) => state.openAppRunSession);

  useEffect(() => {
    if (!run.live || !run.runId || !projectId) return;
    openAppRunSession({ moduleId, projectId, runId: run.runId });
  }, [moduleId, openAppRunSession, projectId, run.live, run.runId]);

  if (!run.live) {
    return (
      <div
        data-testid="app-run-not-running"
        className="flex h-full items-center justify-center text-sm text-text-muted"
      >
        This module's app is not running.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {run.configuration?.preview_url ? (
        <a
          data-testid="app-run-preview-link"
          href={run.configuration.preview_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 border-b border-pane-border px-3 py-1 text-xs text-focus-accent hover:underline"
        >
          {run.configuration.preview_url}
        </a>
      ) : null}
      <div className="min-h-0 flex-1">
        {sessionId ? (
          <Terminal
            key={sessionId}
            sessionId={sessionId}
            owner="panel"
            focusSignal={focusSignal}
            active
          />
        ) : (
          <div data-testid="app-run-pending" className="h-full bg-pane-panel" />
        )}
      </div>
    </div>
  );
}
