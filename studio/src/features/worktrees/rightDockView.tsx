import { IconDependency } from "../../shared/ui/icons";
import type { RightDockViewRegistration } from "../../app/shell/right-dock/types";
import { WorktreesView } from "./internal/WorktreesView";

export const worktreesRightDockView: RightDockViewRegistration = {
  id: "worktrees",
  label: "Worktrees",
  icon: IconDependency,
  isAvailable: ({ projectId, moduleId }) => Boolean(projectId && moduleId),
  render: ({ projectId, moduleId }) =>
    projectId && moduleId ? (
      <WorktreesView projectId={projectId} moduleId={moduleId} />
    ) : null,
};
