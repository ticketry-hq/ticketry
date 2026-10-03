export function SuggestionStatusRecovery({ error, refreshing, onRetry }: {
  error: string | null | undefined;
  refreshing: boolean;
  onRetry: () => void;
}) {
  if (!error && !refreshing) return null;
  return <div className="space-y-1 text-xs text-text-secondary">
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={refreshing} onClick={onRetry}
      className="h-7 border border-pane-border px-2 hover:text-text-primary disabled:opacity-40">
      {refreshing ? "Retrying status…" : "Retry status"}
    </button>
  </div>;
}
