import { useModalStore } from "../modal/modalStore";
import {
  startInstantChangeFlow,
  startOpenFlow,
  startOpenWithPromptFlow,
  startPlanFlow,
} from "../../features/studio/modals/PlanFeature";
import {
  bucketFor,
  useWorkspaceTabsStore,
} from "../../features/agents/terminal/appNavigation";
import { TEMP_TASK_ID } from "../../features/agents/types";
import {
  closeTerminalTab,
  useIssueDrawerWorkspaceStore,
} from "../../features/work-items/issue-detail/appNavigation";
import type { Row } from "../../features/studio/pages/tasks/TasksPane";
import { focusStoriesSearch } from "../../features/studio/pages/tasks/storiesFocus";
import {
  createNavigationContext,
  type NavigationContext,
} from "./navigationContext";

/** Routes shortcuts shared by both Studio layouts. */
export function routeSharedNavigation(
  event: KeyboardEvent,
  taskRows: Row[],
  actionId: string | null,
): void {
  const ctx = createNavigationContext(event, taskRows);
  switch (actionId) {
    case "search":
      focusStoriesSearch();
      event.preventDefault();
      return;
    case "show-shortcuts":
      useModalStore.getState().openKeyboardShortcuts();
      event.preventDefault();
      return;
    case "toggle-sidebar":
      ctx.ui.toggleSidebar();
      event.preventDefault();
      return;
    case "focus-left":
      ctx.ui.focusLeft();
      event.preventDefault();
      return;
    case "focus-right":
      ctx.ui.focusRight();
      event.preventDefault();
      return;
    case "open-agent":
    case "open-agent-command":
      if (ctx.tasks.selectedTaskId) {
        startOpenFlow();
        event.preventDefault();
      }
      return;
    case "plan":
      if (ctx.tasks.selectedModuleId) {
        startPlanFlow();
        event.preventDefault();
      }
      return;
    case "instant-change":
      if (ctx.tasks.selectedModuleId) {
        startInstantChangeFlow();
        event.preventDefault();
      }
      return;
    case "status":
      openStatus(ctx);
      return;
    case "settings":
      useModalStore.getState().openSettings();
      event.preventDefault();
      return;
    case "set-folder":
      openModuleFolder(ctx);
      return;
    case "close-tab":
      closeActiveWorkspaceTab(ctx);
      return;
    case "open-with-prompt":
    case "open-with-prompt-command":
      if (event.shiftKey && ctx.tasks.selectedTaskId) {
        startOpenWithPromptFlow();
        event.preventDefault();
      }
      return;
  }
}

function openStatus(ctx: NavigationContext): void {
  if (
    !ctx.tasks.selectedTaskId ||
    ctx.tasks.selectedTaskId === TEMP_TASK_ID
  ) return;
  useModalStore.getState().pushModal({ type: "status-update" });
  ctx.event.preventDefault();
}

function openModuleFolder(ctx: NavigationContext): void {
  if (!ctx.tasks.selectedModuleId) return;
  useModalStore.getState().pushModal({
    type: "module-folder",
    payload: { moduleId: ctx.tasks.selectedModuleId },
  });
  ctx.event.preventDefault();
}

function closeActiveWorkspaceTab(ctx: NavigationContext): void {
  const taskId = ctx.tasks.selectedTaskId;
  if (!taskId) return;
  const bucket = bucketFor(
    taskId === TEMP_TASK_ID ? null : taskId,
    ctx.tasks.selectedModuleId,
  );

  const workspace = useIssueDrawerWorkspaceStore.getState();
  const current = workspace.workspaces[bucket];
  const active = current?.active ?? "details";

  if (active === "doc") {
    const activeDocId =
      current?.activeDocId ??
      current?.docs.find((document) => document.open)?.docId ??
      null;
    if (activeDocId) {
      workspace.closeDoc(bucket, activeDocId);
      ctx.event.preventDefault();
    }
    return;
  }
  if (active !== "terminal") return;

  const sessionId = useWorkspaceTabsStore.getState().activeByTask[bucket];
  if (!sessionId) return;
  void closeTerminalTab(sessionId, bucket);
  ctx.event.preventDefault();
}
