import { useEpicEntry, type EpicEntryProps } from "./useEpicEntry";

export default function NewEpicChip(props: EpicEntryProps) {
  const entry = useEpicEntry(props);
  if (entry.state.kind === "closed") return <button type="button" onClick={entry.open} className="px-3 py-1 text-focus-accent">+ New epic</button>;
  const busy = entry.state.kind === "creating";
  return <div className="flex flex-wrap gap-2 px-3 py-1">
    <input autoFocus aria-label="New epic name" value={entry.name} disabled={busy} readOnly={entry.state.kind === "refreshFailed"}
      onChange={(event) => entry.setName(event.target.value)} onBlur={() => { if (!entry.name.trim()) entry.close(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void entry.submit(); }
        if (event.key === "Escape") { event.stopPropagation(); entry.close(); }
      }} className="h-7 border border-pane-border bg-pane-bg px-2 text-text-primary" />
    {entry.state.kind === "refreshFailed" && <button type="button" onClick={() => void entry.submit()}>Retry refresh</button>}
    {(entry.state.kind === "editing" || entry.state.kind === "refreshFailed") && entry.state.error && <p role="alert" className="w-full text-sm text-lifecycle-danger">{entry.state.error}</p>}
  </div>;
}
