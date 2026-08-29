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
  useTicketWorkspaceStore,
} from "../shell/ticket-workspace/selected-ticket/appNavigation";
import type { TreeRow } from "../shell/ticket-workspace/tasks/TasksPane";
import { focusStoriesSearch } from "../shell/ticket-workspace/tasks/storiesFocus";
import {
  createNavigationContext,
  type NavigationContext,
} from "./navigationContext";
import { getVisibleModulesSnapshot } from "../../features/module-tabs";
import { useStudioStore } from "../../features/projects";
import { useClientStore } from "../../state/clientStore";
import { startRunNowForSelectedItem } from "../../features/work-items";

const MODULE_POSITION_ACTION_PREFIX = "modules.select-position-";
const MODULE_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type ModulePosition = (typeof MODULE_POSITIONS)[number];
export type ModulePositionActionId =
  `modules.select-position-${ModulePosition}`;

export function isModulePosition(position: number): position is ModulePosition {
  return MODULE_POSITIONS.some((candidate) => candidate === position);
}

export function modulePositionActionId(
  position: ModulePosition,
): ModulePositionActionId {
  return `${MODULE_POSITION_ACTION_PREFIX}${position}`;
}

/**
 * Routes application-level module selection before focused controls can claim
 * the event. Returns true only when a different, present module was selected.
 */
export function routeModulePositionNavigation(
  event: Pick<KeyboardEvent, "preventDefault"> | null,
  actionId: string | null,
): boolean {
  if (!actionId?.startsWith(MODULE_POSITION_ACTION_PREFIX)) return false;

  const position = Number(actionId.slice(MODULE_POSITION_ACTION_PREFIX.length));
  if (!isModulePosition(position)) return false;

  const selected = selectModuleAtPosition(position);
  if (selected) event?.preventDefault();
  return selected;
}

function selectModuleAtPosition(position: ModulePosition): boolean {
  const projectId = useStudioStore.getState().selectedProjectId;
  const ui = useClientStore.getState();
  const module = getVisibleModulesSnapshot(projectId)[position - 1];
  if (!module || module.id === ui.selectedModuleId) return false;

  void ui.selectModule(module.id);
  return true;
}

/** Routes shortcuts shared by both Studio layouts. */
export function routeSharedNavigation(
  event: KeyboardEvent,
  taskRows: TreeRow[],
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
    case "run-now":
      if (startRunNowForSelectedItem()) event.preventDefault();
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

  const workspace = useTicketWorkspaceStore.getState();
  const current = workspace.workspaces[bucket];
  const active = current?.active ?? "details";

  if (active === "doc") {
    const activeDocId = current?.activeDocId ?? null;
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
