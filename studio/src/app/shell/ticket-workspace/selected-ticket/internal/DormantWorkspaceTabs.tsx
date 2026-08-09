import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../../../../../features/agents/types";
import type { RunRecord } from "../../../../../features/agents/status";

export function DormantWorkspaceTabs({
  closedDocuments,
  resumableSessions,
  visibleHistory,
  resumingRunId,
  onReopenDocument,
  onResumeTerminal,
}: {
  closedDocuments: readonly DesignDoc[];
  resumableSessions: readonly ResumableTerminalSession[];
  visibleHistory: readonly RunRecord[];
  resumingRunId: string | null;
  onReopenDocument: (docId: string) => void;
  onResumeTerminal: (session: ResumableTerminalSession) => void;
}) {
  if (
    closedDocuments.length === 0 &&
    resumableSessions.length === 0 &&
    visibleHistory.length === 0
  ) {
    return null;
  }

  return (
    <div className="mb-1 flex shrink-0 flex-wrap gap-1">
      {closedDocuments.map((document) => (
        <button
          key={document.id}
          type="button"
          aria-label={`Reopen ${document.label}`}
          onClick={() => onReopenDocument(document.id)}
          className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary"
        >
          + {document.label}
        </button>
      ))}
      {resumableSessions.map((session) => (
        <button
          key={session.agent_run_id}
          type="button"
          aria-label={`Resume ${session.agent} terminal`}
          title={`Resume · ${session.started_at}`}
          disabled={resumingRunId !== null}
          onClick={() => onResumeTerminal(session)}
          className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted hover:border-focus-accent hover:text-text-primary disabled:cursor-wait disabled:opacity-50"
        >
          {resumingRunId === session.agent_run_id
            ? "Resuming…"
            : `↻ ${session.agent}`}
        </button>
      ))}
      {visibleHistory.map((chip, index) => (
        <span
          key={`${chip.agent_run_id}-${index}`}
          title="Terminated run"
          className="shrink-0 border border-dashed border-pane-border px-2 py-0.5 text-xs text-text-muted opacity-60"
        >
          {chip.agent ?? "Agent"} ✕
        </span>
      ))}
    </div>
  );
}
