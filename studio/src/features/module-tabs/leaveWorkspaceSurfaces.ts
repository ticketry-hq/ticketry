import { leaveChangesWorkspace, useChangesWorkspace } from "../agents/worktrees";
import { leavePlanWorkspace, selectPlanWorkspaceActive, usePlanWorkspace } from "../sprints";

/** Plan and Changes restore their origin when left, so module selection exits them first. */
export function leaveWorkspaceSurfaces(): void {
  if (selectPlanWorkspaceActive(usePlanWorkspace.getState())) leavePlanWorkspace();
  if (useChangesWorkspace.getState().active) leaveChangesWorkspace();
}
