export function ChangesActionAlert({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (!error && !notice) return null;
  return (
    <div className="shrink-0 border-b border-pane-border px-3 py-1.5 text-xs">
      {error ? <p role="alert" className="text-lifecycle-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-lifecycle-success">{notice}</p> : null}
    </div>
  );
}
