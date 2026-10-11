import { useClientStore } from "../../../state/clientStore";
import { useStorySprintFilter } from "./StorySprintFilterController";

export function StoriesFilterEmptyState() {
  const query = useClientStore((state) => state.storySearchQuery.trim());
  const setQuery = useClientStore((state) => state.setStorySearchQuery);
  const filter = useStorySprintFilter();
  return <div className="mb-2 border border-pane-border bg-pane-bg px-3 py-2">
    <p role="status" className="text-sm text-text-muted">{query ? `No stories match "${query}".` : "No stories in this sprint."}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {query ? <button type="button" aria-label="Clear story search" onClick={() => setQuery("")} className="border border-pane-border px-2 py-1 text-xs text-text-primary">Clear search</button> : null}
      {filter.restricted ? <button type="button" onClick={() => filter.setIntent({ mode: "all" })} className="border border-pane-border px-2 py-1 text-xs text-text-primary">Show all sprints</button> : null}
    </div>
  </div>;
}
