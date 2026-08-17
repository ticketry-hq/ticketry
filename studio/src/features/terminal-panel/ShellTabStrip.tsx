/**
 * The terminal panel's own tab strip (#668).
 *
 * It names the shells one module owns and which one is showing. It is not the
 * workspace tab strip and shares nothing with it: these tabs carry no agent, no
 * lifecycle state and no work item, so there is no status to render — only a
 * position, a close affordance, and the action that adds one more.
 */

import { deadShell, MAX_MODULE_SHELLS, type ModuleShellSet } from "./shellTabSet";

export function ShellTabStrip({
  shells,
  onSelect,
  onClose,
  onCreate,
}: {
  shells: ModuleShellSet;
  onSelect: (runId: string) => void;
  onClose: (runId: string) => void;
  onCreate: () => void;
}) {
  const full = shells.runIds.length >= MAX_MODULE_SHELLS;
  return (
    <div
      data-testid="terminal-panel-tabs"
      role="tablist"
      aria-label="Module shells"
      // The strip sits inside the panel header, which owns the row's own
      // border and background: the panel's furniture is not a tab.
      className="flex items-stretch"
    >
      {shells.runIds.map((runId, index) => {
        const active = runId === shells.activeRunId;
        // A shell that ended badly keeps its tab, and says so on it: the strip
        // is where a background failure is noticed at all (#670).
        const dead = deadShell(shells, runId);
        return (
          <div
            key={runId}
            data-testid="terminal-panel-tab"
            data-run-id={runId}
            data-active={active ? "true" : "false"}
            data-dead={dead ? "true" : "false"}
            className={`flex items-center gap-2 border-r border-pane-border px-3 py-1 ${
              active ? "bg-pane-panel text-text-primary" : "text-text-muted"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              // The shell's own number is all a tab can honestly say: naming the
              // running subprocess needs a metadata channel that does not exist.
              onClick={() => onSelect(runId)}
            >
              {dead
                ? `Shell ${index + 1} · exit ${dead.exitCode ?? "?"}`
                : `Shell ${index + 1}`}
            </button>
            <button
              type="button"
              data-testid="terminal-panel-tab-close"
              aria-label={`Close shell ${index + 1}`}
              onClick={() => onClose(runId)}
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="terminal-panel-new-shell"
        aria-label="New shell"
        // At the cap the control stays visible and disabled rather than
        // vanishing, so the bound is something a person can see they hit.
        disabled={full || shells.busy}
        title={full ? `A module can hold ${MAX_MODULE_SHELLS} shells.` : "New shell"}
        onClick={onCreate}
        className="px-3 py-1 text-text-muted hover:text-text-primary disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
