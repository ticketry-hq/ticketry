import type { Row } from "../../../features/studio/pages/tasks/TasksPane";
import { useUIStore } from "../../../features/studio/stores/uiStore";
import { routeTaskWorkspaceEditViewAction } from "../../../features/work-items/issue-detail/appNavigation";
import { isTypingTarget } from "../../../shared/utilities/keyboard";
import {
  consume,
  createNavigationContext,
  currentTaskRow,
  moveTaskSelection,
} from "../navigationContext";

export const EDIT_VIEW_BODY_DISENGAGE_CHORD = {
  key: "Escape",
  alt: false,
  control: false,
  meta: true,
  shift: false,
} as const;

/**
 * Routes the modal, three-zone keyboard model used while the sidebar is hidden.
 */
export function routeThreeZoneNavigation(
  event: KeyboardEvent,
  taskRows: Row[],
  actionId: string | null,
): boolean {
  if (actionId === "edit-view.next-zone") {
    consume(event);
    const ui = useUIStore.getState();
    ui.setNavigationModality("keyboard");
    ui.cycleEditViewZone();
    return true;
  }

  if (!actionId?.startsWith("edit-view.") || isTypingTarget(event.target)) {
    return false;
  }

  const ctx = createNavigationContext(event, taskRows);
  let routed: boolean;
  switch (ctx.ui.editViewZone) {
    case "stories":
      routed = routeStoriesZone(ctx, actionId);
      break;
    case "tab-strip":
      routed = routeTabStripZone(event, actionId);
      break;
    case "active-tab-body":
      routed = routeActiveTabBodyZone(event, actionId);
      break;
  }
  if (routed) ctx.ui.setNavigationModality("keyboard");
  return routed;
}

/**
 * Gives an engaged body every key except Cmd+Escape.
 */
export function routeThreeZoneBodyEngagement(event: KeyboardEvent): boolean {
  const ui = useUIStore.getState();
  const isEngaged =
    ui.editViewZone === "active-tab-body" &&
    ui.editViewBodyEngaged;
  if (!isEngaged) return false;

  if (
    event.key === EDIT_VIEW_BODY_DISENGAGE_CHORD.key &&
    event.metaKey === EDIT_VIEW_BODY_DISENGAGE_CHORD.meta &&
    event.altKey === EDIT_VIEW_BODY_DISENGAGE_CHORD.alt &&
    event.ctrlKey === EDIT_VIEW_BODY_DISENGAGE_CHORD.control &&
    event.shiftKey === EDIT_VIEW_BODY_DISENGAGE_CHORD.shift
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ui.setEditViewBodyEngaged(false);
    ui.setNavigationModality("keyboard");
    document
      .querySelector<HTMLElement>(
        '[data-navigation-zone="active-tab-body"]',
      )
      ?.focus({ preventScroll: true });
  }
  return true;
}

function routeActiveTabBodyZone(
  event: KeyboardEvent,
  actionId: string,
): boolean {
  if (actionId === "edit-view.commit") {
    return workspaceActionHandled(
      routeTaskWorkspaceEditViewAction(event, "engage-active"),
    );
  }

  const destination =
    actionId === "edit-view.up"
      ? "tab-strip"
      : actionId === "edit-view.left"
        ? "stories"
        : null;
  if (!destination) return false;

  consume(event);
  useUIStore.getState().setEditViewZone(destination);
  return true;
}

function routeStoriesZone(
  ctx: ReturnType<typeof createNavigationContext>,
  actionId: string,
): boolean {
  switch (actionId) {
    case "edit-view.up":
      return moveTaskSelection(ctx, -1);
    case "edit-view.down":
      return moveTaskSelection(ctx, 1);
    case "edit-view.left":
      return setTaskExpanded(ctx, false);
    case "edit-view.right":
      return expandTaskOrExitToTabStrip(ctx);
    case "edit-view.commit":
      return workspaceActionHandled(
        routeTaskWorkspaceEditViewAction(ctx.event, "dive-active"),
      );
    default:
      return false;
  }
}

function routeTabStripZone(
  event: KeyboardEvent,
  actionId: string,
): boolean {
  switch (actionId) {
    case "edit-view.left": {
      const outcome = routeTaskWorkspaceEditViewAction(
        event,
        "highlight-previous",
      );
      if (outcome === "clamped") {
        useUIStore.getState().setEditViewZone("stories");
      }
      return workspaceActionHandled(outcome);
    }
    case "edit-view.right":
      return workspaceActionHandled(
        routeTaskWorkspaceEditViewAction(event, "highlight-next"),
      );
    case "edit-view.down":
    case "edit-view.commit":
      return workspaceActionHandled(
        routeTaskWorkspaceEditViewAction(event, "commit-highlight"),
      );
    default:
      return false;
  }
}

function workspaceActionHandled(
  outcome: ReturnType<typeof routeTaskWorkspaceEditViewAction>,
): boolean {
  return outcome !== "unavailable";
}

function expandTaskOrExitToTabStrip(
  ctx: ReturnType<typeof createNavigationContext>,
): boolean {
  const row = currentTaskRow(ctx);
  if (!row) return false;
  if (row.hasChildren && !row.isExpanded) {
    consume(ctx.event);
    ctx.ui.setExpanded(row.task.id, true);
    return true;
  }
  if (
    routeTaskWorkspaceEditViewAction(ctx.event, "probe-navigable") ===
    "unavailable"
  ) {
    return false;
  }
  consume(ctx.event);
  ctx.ui.setEditViewZone("tab-strip");
  return true;
}

function setTaskExpanded(
  ctx: ReturnType<typeof createNavigationContext>,
  expanded: boolean,
): boolean {
  consume(ctx.event);
  const row = currentTaskRow(ctx);
  if (row?.hasChildren) ctx.ui.setExpanded(row.task.id, expanded);
  return true;
}
