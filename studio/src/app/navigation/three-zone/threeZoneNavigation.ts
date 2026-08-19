import type { TreeRow } from "../../shell/ticket-workspace/tasks/TasksPane";
import { isEngageableZone, useClientStore } from "../../../state/clientStore";
import { useTerminalPanelStore } from "../../../features/terminal-panel/panelStore";
import { routeTaskWorkspaceEditViewAction } from "../../shell/ticket-workspace/selected-ticket/appNavigation";
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
  taskRows: TreeRow[],
  actionId: string | null,
): boolean {
  if (actionId === "edit-view.next-zone") {
    consume(event);
    const ui = useClientStore.getState();
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
    case "terminal-panel":
      routed = routeTerminalPanelZone(event, actionId);
      break;
  }
  if (routed) ctx.ui.setNavigationModality("keyboard");
  return routed;
}

/**
 * Gives an engaged body every key except Cmd+Escape. The terminal panel engages
 * the same way, so leaving its shell is the one chord a developer already knows
 * — and it leaves typing without closing the panel (#669).
 */
export function routeThreeZoneBodyEngagement(event: KeyboardEvent): boolean {
  const ui = useClientStore.getState();
  const isEngaged = isEngageableZone(ui.editViewZone) && ui.editViewBodyEngaged;
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
    // Focus lands on the zone the developer was typing in, so the panel stays
    // open and stays the current zone.
    document
      .querySelector<HTMLElement>(
        `[data-navigation-zone="${ui.editViewZone}"]`,
      )
      ?.focus({ preventScroll: true });
  }
  return true;
}

/**
 * The panel is a single surface with one shell in it, so its zone-local keys are
 * just the routes out of it and the route back into typing.
 */
function routeTerminalPanelZone(
  event: KeyboardEvent,
  actionId: string,
): boolean {
  if (actionId === "edit-view.commit") {
    consume(event);
    useClientStore.getState().setEditViewBodyEngaged(true);
    useTerminalPanelStore.getState().focusShell();
    return true;
  }

  const destination =
    actionId === "edit-view.up"
      ? "active-tab-body"
      : actionId === "edit-view.left"
        ? "stories"
        : null;
  if (!destination) return false;

  consume(event);
  useClientStore.getState().setEditViewZone(destination);
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
  useClientStore.getState().setEditViewZone(destination);
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
      return expandTaskOrDiveActiveBody(ctx);
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
        useClientStore.getState().setEditViewZone("stories");
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

/**
 * Right expands while expansion remains; otherwise it dives straight into the
 * remembered Active tab body, exactly where Enter lands. The workspace tab
 * strip is a sibling navigation zone, not a waypoint on this route.
 *
 * Only the expand branch needs a work-item row: rows without expansion of
 * their own (the scratch workspace row) fall through to the same dive Enter
 * takes, so Right always lands where Enter lands.
 */
function expandTaskOrDiveActiveBody(
  ctx: ReturnType<typeof createNavigationContext>,
): boolean {
  const row = currentTaskRow(ctx);
  if (row?.expandable && !row.expanded) {
    consume(ctx.event);
    const moduleId = ctx.tasks.selectedModuleId;
    if (moduleId) ctx.ui.setExpanded(moduleId, row.id, true);
    return true;
  }
  return workspaceActionHandled(
    routeTaskWorkspaceEditViewAction(ctx.event, "dive-active"),
  );
}

function setTaskExpanded(
  ctx: ReturnType<typeof createNavigationContext>,
  expanded: boolean,
): boolean {
  consume(ctx.event);
  const row = currentTaskRow(ctx);
  const moduleId = ctx.tasks.selectedModuleId;
  if (row?.expandable && moduleId) {
    ctx.ui.setExpanded(moduleId, row.id, expanded);
  }
  return true;
}
