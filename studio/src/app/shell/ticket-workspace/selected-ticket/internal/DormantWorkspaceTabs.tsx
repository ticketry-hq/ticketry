import type {
  DesignDoc,
  ResumableTerminalSession,
} from "../../../../../features/agents/types";
import {
  providerToneClasses,
  type DormantTerminalChip,
} from "../../../../../features/agents/terminal";

// The row of things this workspace is not currently looking at: documents you
// closed, conversations you can resume, and terminated runs kept as history.
//
// The terminal chips speak the tab strip's vocabulary (#695) — the phase the
// conversation began in, the provider in colour, the recorded launch facts on
// hover — because they are the same runs. The dashed border keeps "dormant"
// legible as its own axis, independent of the provider tone inside it.

export function DormantWorkspaceTabs({
  closedDocuments,
  resumableChips,
  historyChips,
  resumableSessions,
  resumingRunIds,
  onReopenDocument,
  onResumeTerminal,
}: {
  closedDocuments: readonly DesignDoc[];
  resumableChips: readonly DormantTerminalChip[];
  historyChips: readonly DormantTerminalChip[];
  resumableSessions: readonly ResumableTerminalSession[];
  resumingRunIds: ReadonlySet<string>;
  onReopenDocument: (docId: string) => void;
  onResumeTerminal: (session: ResumableTerminalSession) => void;
}) {
  if (
    closedDocuments.length === 0 &&
    resumableChips.length === 0 &&
    historyChips.length === 0
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
      {resumableChips.map((chip) => {
        const session = resumableSessions.find(
          (candidate) => candidate.agent_run_id === chip.key,
        );
        if (!session) return null;
        return (
          <button
            key={chip.key}
            type="button"
            aria-label={`Resume ${chip.accessibleName}`}
            title={chip.hoverTitle || undefined}
            disabled={resumingRunIds.has(chip.key)}
            onClick={() => onResumeTerminal(session)}
            className={`shrink-0 border border-dashed px-2 py-0.5 text-xs hover:border-focus-accent disabled:cursor-wait disabled:opacity-50 ${providerToneClasses(
              { agent: chip.agent, live: chip.live, selected: false },
            )}`}
          >
            {resumingRunIds.has(chip.key) ? "Resuming…" : `↻ ${chip.label}`}
          </button>
        );
      })}
      {historyChips.map((chip) => (
        <span
          key={chip.key}
          // Assistive text has no colour to read the provider from, so the chip
          // names it the same way a tab's accessible name does.
          aria-label={`Terminated ${chip.accessibleName}`}
          title={chip.hoverTitle || "Terminated run"}
          className={`shrink-0 border border-dashed px-2 py-0.5 text-xs opacity-60 ${providerToneClasses(
            { agent: chip.agent, live: chip.live, selected: false },
          )}`}
        >
          {chip.label} ✕
        </span>
      ))}
    </div>
  );
}
