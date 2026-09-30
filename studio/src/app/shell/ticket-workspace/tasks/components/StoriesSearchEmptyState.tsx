import { useClientStore } from "../../../../../state/clientStore";

interface Props {
  selectedStoryOutsideFilter: boolean;
}

export function StoriesSearchEmptyState({
  selectedStoryOutsideFilter,
}: Props) {
  const query = useClientStore((state) => state.storySearchQuery.trim());
  const setQuery = useClientStore((state) => state.setStorySearchQuery);

  return (
    <div className="mb-2 border border-pane-border bg-pane-bg px-3 py-2">
      <p role="status" aria-live="polite" className="text-sm text-text-muted">
        No stories match "{query}".
        {selectedStoryOutsideFilter
          ? " The selected story remains open in Details but is outside the filtered results."
          : null}
      </p>
      <button
        type="button"
        aria-label="Clear story search"
        onClick={() => setQuery("")}
        className="mt-2 border border-pane-border bg-pane-title px-2 py-1 text-xs font-medium text-text-primary hover:border-focus-accent"
      >
        Clear search
      </button>
    </div>
  );
}
