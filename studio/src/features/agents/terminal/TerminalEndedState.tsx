export function TerminalEndedState({ conversation }: { conversation: boolean }) {
  return (
    <div
      role="status"
      data-testid="terminal-ended-state"
      className="flex h-full items-center justify-center bg-pane-panel px-6 text-center"
    >
      <div className="max-w-md">
        <div className="text-sm font-medium text-text-primary">
          {conversation ? "Conversation ended" : "Terminal ended"}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          The run finished and its terminal session is closed.
        </p>
      </div>
    </div>
  );
}
