import { usePlanningGraph } from "../planning-graph";
import { useCreateSprint, useUpdateSprint } from "./mutations";
import { openPlanItem, openPlanSprint, usePlanWorkspace } from "./planWorkspaceState";
import SprintsList, { type SprintsListProps } from "./SprintsList";

export type SprintsViewProps = Pick<SprintsListProps,
  "renderSprintGoals" | "renderSuggestionAgentBox"
> & { projectId: string };

export default function SprintsView(props: SprintsViewProps) {
  return <ProjectSprintsView key={props.projectId} {...props} />;
}

function ProjectSprintsView({ projectId, ...slots }: SprintsViewProps) {
  const { graph, loading, error } = usePlanningGraph(projectId);
  const { create } = useCreateSprint(projectId);
  const { update } = useUpdateSprint();
  const openStoryId = usePlanWorkspace((state) => state.openItem);
  if (!graph) {
    return <p className="p-4 text-sm text-text-muted" role={error ? "alert" : "status"}>
      {error ?? (loading ? "Loading sprints…" : "No sprint data available.")}
    </p>;
  }
  return <SprintsList graph={graph} openStoryId={openStoryId}
    onOpenStory={(id) => { void openPlanItem(id); }} onOpenSprint={openPlanSprint}
    onCreateSprint={create} onUpdateSprint={update} {...slots} />;
}
