/**
 * What the panel shows where a failed shell's terminal was (#670).
 *
 * A shell that ended badly is usually the only record of what went wrong, so
 * the panel states the code it ended on rather than going blank or quietly
 * removing the tab. The one action offered mints a *new* shell in the same
 * slot: the dead session cannot be reopened, and offering to "reconnect" to it
 * would promise something no durable session is left to give.
 */

export function DeadShell({
  exitCode,
  busy,
  onRestart,
}: {
  exitCode: number | null;
  busy: boolean;
  onRestart: () => void;
}) {
  return (
    <div
      data-testid="terminal-panel-dead-shell"
      data-exit-code={exitCode === null ? "" : String(exitCode)}
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-text-muted"
    >
      <p>
        {exitCode === null
          ? "Shell ended without reporting an exit code."
          : `Shell exited with code ${exitCode}.`}
      </p>
      <button
        type="button"
        data-testid="terminal-panel-restart-shell"
        disabled={busy}
        onClick={onRestart}
        className="border border-pane-border px-3 py-1 text-text-primary hover:bg-pane-title disabled:opacity-40"
      >
        Restart shell
      </button>
    </div>
  );
}
