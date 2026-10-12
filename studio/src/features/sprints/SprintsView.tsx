import type { ReactNode } from "react";
import { usePlanningGraph } from "../planning-graph";
import { useCreateSprint, useUpdateSprint } from "./mutations";
import { openPlanItem, openPlanSprint, usePlanWorkspace } from "./planWorkspaceState";
import SprintsList, { type SprintsListProps } from "./SprintsList";
import { editionHas } from "../../shared/config/edition";
import { useReorderSprint } from "./useReorderSprint";

export type SprintsViewProps = Pick<SprintsListProps,
  "renderSprintGoals" | "renderSuggestionAgentBox"
> & { projectId: string; renderWorkItemDetail?: (id: string) => ReactNode };

export default function SprintsView(props: SprintsViewProps) {
  return editionHas("sprintPlanning") ? <ProjectSprintsView key={props.projectId} {...props} /> : null;
}

function ProjectSprintsView({ projectId, renderWorkItemDetail, ...slots }: SprintsViewProps) {
  const { graph, loading, error } = usePlanningGraph(projectId);
  const { create } = useCreateSprint(projectId);
  const { update } = useUpdateSprint(projectId);
  const { reorder, busy: reorderBusy } = useReorderSprint(projectId);
  const openStoryId = usePlanWorkspace((state) => state.openItem);
  if (!graph) {
    return <p className="p-4 text-sm text-text-muted" role={error ? "alert" : "status"}>
      {error ?? (loading ? "Loading sprints…" : "No sprint data available.")}
    </p>;
  }
  return <div className="flex h-full min-h-0 min-w-0 flex-col md:flex-row">
    <div className="min-h-0 min-w-0 flex-1"><SprintsList graph={graph} openStoryId={openStoryId}
    onOpenStory={(id) => { void openPlanItem(id); }} onOpenSprint={openPlanSprint}
    onCreateSprint={create} onUpdateSprint={update} onReorderSprint={reorder} reorderBusy={reorderBusy} {...slots} /></div>
    {openStoryId && renderWorkItemDetail && <aside aria-label="Selected ticket"
      className="flex min-h-0 min-w-0 flex-col border-l border-pane-border bg-pane-panel md:w-[38%]">
      <button type="button" aria-label="Close selected ticket"
        onClick={() => usePlanWorkspace.setState({ openItem: null, pendingOpenItem: null })}
        className="self-end px-3 py-1 text-text-muted">×</button>
      {renderWorkItemDetail(openStoryId)}
    </aside>}
  </div>;
}
