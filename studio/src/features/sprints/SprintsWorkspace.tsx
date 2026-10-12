import { useEffect, type ReactNode } from "react";
import { useStudioStore } from "../projects";
import { usePlanningGraph } from "../planning-graph";
import SprintsView, { type SprintsViewProps } from "./SprintsView";
import SprintGoals from "./goals/SprintGoals";
import { SuggestionAgentBox } from "./suggestions/SuggestionAgentBox";
import PlanSprintView from "./planning/PlanSprintView";
import { leavePlanWorkspace, openPlanWorkspace, selectPlanWorkspaceActive, usePlanWorkspace } from "./planWorkspaceState";
import { editionHas } from "../../shared/config/edition";

type SprintsWorkspaceProps = Partial<Pick<SprintsViewProps, "renderSprintGoals" | "renderSuggestionAgentBox">> & {
  renderWorkItemDetail: (id: string) => ReactNode;
};

export function SprintsWorkspace(props: SprintsWorkspaceProps) {
  return editionHas("sprintPlanning") ? <AvailableSprintsWorkspace {...props} /> : null;
}

function AvailableSprintsWorkspace({ renderWorkItemDetail, renderSprintGoals, renderSuggestionAgentBox }: SprintsWorkspaceProps) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const active = usePlanWorkspace(selectPlanWorkspaceActive);
  const { projectId: workspaceProjectId, sprintId, defaultSprintPending } = usePlanWorkspace();
  const { graph } = usePlanningGraph(projectId);
  useEffect(() => {
    const state = usePlanWorkspace.getState();
    if (selectPlanWorkspaceActive(state) && state.projectId !== projectId) { leavePlanWorkspace(); return; }
    if (graph && selectPlanWorkspaceActive(state) && state.defaultSprintPending && state.projectId === projectId) openPlanWorkspace();
  }, [graph, projectId, defaultSprintPending, active, workspaceProjectId]);
  if (!projectId || !active || workspaceProjectId !== projectId) return null;
  return sprintId ? <PlanSprintView key={`${projectId}:${sprintId}`} projectId={projectId}
    sprintId={sprintId} renderWorkItemDetail={renderWorkItemDetail} />
    : <SprintsView key={projectId} projectId={projectId}
      renderWorkItemDetail={renderWorkItemDetail}
      renderSprintGoals={renderSprintGoals ?? ((sprint) => <SprintGoals sprintId={sprint.id} completed={sprint.status === "completed"} />)}
      renderSuggestionAgentBox={renderSuggestionAgentBox ?? ((sprint) => <SuggestionAgentBox projectId={projectId} sprintId={sprint.id} />)} />;
}
