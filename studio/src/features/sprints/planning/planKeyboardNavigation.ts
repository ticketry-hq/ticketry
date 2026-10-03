import { leavePlanWorkspace, setPlanVisit, usePlanWorkspace } from "../planWorkspaceState";
import { stepEpicTab } from "./epicTabs";

export function routePlanKeyboardNavigation(event: KeyboardEvent): void {
  const workspace = usePlanWorkspace.getState();
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
    (event.code === "BracketRight" || event.code === "BracketLeft")) {
    const visit = workspace.sprintId ? workspace.visits[workspace.sprintId] : null;
    if (visit && workspace.sprintId) {
      event.preventDefault();
      setPlanVisit(workspace.sprintId, stepEpicTab(visit, event.code === "BracketRight" ? 1 : -1));
    }
  }
  if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  if (workspace.openItem || workspace.pendingOpenItem) {
    usePlanWorkspace.setState({ openItem: null, pendingOpenItem: null });
  } else {
    leavePlanWorkspace();
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="workspace-tab-plan"]')?.focus();
    });
  }
}
