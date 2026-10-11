import { useStoriesTree } from "../queries/StoriesTreeProvider";

export function SelectedStoryFilterNotice({ issueId }: { issueId: string }) {
  const { itemsById, resultIds, sprintFilter, isSearchActive, loadingTasks } = useStoriesTree();
  if (sprintFilter.selection === null || loadingTasks || !itemsById[issueId]
    || !(sprintFilter.restricted || isSearchActive) || resultIds.has(issueId)) return null;
  return <div role="status" className="mx-4 my-2 shrink-0 border-l-2 border-focus-accent bg-pane-title/50 px-3 py-2 text-xs text-text-muted">
    This story is outside the current results. It stays open here.
  </div>;
}
