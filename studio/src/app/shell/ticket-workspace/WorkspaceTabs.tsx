import type { KeyboardEvent } from "react";
import { IconGitBranch } from "../../../shared/ui/icons";
import { useStudioStore } from "../../../features/projects";
import {
  leaveChangesWorkspace,
  openModuleChangesWorkspace,
  useChangesWorkspace,
} from "../../../features/agents/worktrees";
import { leavePlanWorkspace, openPlanWorkspace, usePlanWorkspace } from "../../../features/sprints";
import { useClientStore } from "../../../state/clientStore";

export function WorkspaceTabs({ moduleName }: { moduleName?: string }) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const planActive = usePlanWorkspace((state) => state.active);
  const planModuleId = usePlanWorkspace((state) => state.origin?.selectedModuleId ?? null);
  const changes = useChangesWorkspace();
  const moduleId = changes.active ? changes.moduleId : planActive ? planModuleId : selectedModuleId;
  const changesLabel = moduleName ? `Changes · ${moduleName}` : "Changes";
  const selectPlan = () => {
    if (changes.active) leaveChangesWorkspace();
    if (!planActive) openPlanWorkspace();
  };
  const selectChanges = () => {
    if (changes.active) return;
    if (planActive) leavePlanWorkspace();
    const restoredModuleId = useClientStore.getState().selectedModuleId;
    if (restoredModuleId) openModuleChangesWorkspace(restoredModuleId);
  };
  const activate = (event: KeyboardEvent<HTMLButtonElement>, select: () => void) => {
    if ((event.key !== "Enter" && event.key !== " ") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    select();
  };
  const className = (selected: boolean) =>
    "flex shrink-0 items-center gap-1 border-r border-pane-border px-3 text-xs disabled:opacity-50 " +
    (selected ? "bg-pane-panel font-semibold text-text-primary shadow-[inset_0_-2px_0_0_#7aa2f7]" : "text-text-muted hover:bg-pane-panel hover:text-text-primary");
  return <>
    <button type="button" role="tab" data-testid="workspace-tab-plan"
      aria-selected={planActive} tabIndex={planActive ? 0 : -1} disabled={!projectId}
      onClick={selectPlan} onKeyDown={(event) => activate(event, selectPlan)} className={className(planActive)}>
      <span aria-hidden="true">◆</span><span>Plan</span>
    </button>
    <button type="button" role="tab" data-testid="workspace-tab-changes" data-changes-keyboard-entry
      aria-label={changesLabel} aria-selected={changes.active} tabIndex={changes.active ? 0 : -1}
      title={moduleId ? changesLabel : "Select a module to open Changes"} disabled={!moduleId}
      onClick={selectChanges} onKeyDown={(event) => activate(event, selectChanges)} className={className(changes.active)}>
      <IconGitBranch size={14} data-testid="version-control-icon" /><span>{changesLabel}</span>
    </button>
  </>;
}
