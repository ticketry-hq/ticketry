import { useEffect, useRef } from "react";
import { useModalStore } from "../modal/modalStore";
import { useClientStore } from "../../state/clientStore";
import { isTypingTarget } from "../../shared/utilities/keyboard";
import {
  focusedPaneActionIds,
  routeFullSidebarViewCaptureNavigation,
  routeFullSidebarViewFocusedPaneNavigation,
} from "./full-sidebar-view/fullSidebarViewNavigation";
import {
  routeThreeZoneNavigation,
  routeThreeZoneBodyEngagement,
} from "./three-zone/threeZoneNavigation";
import {
  routeModulePositionNavigation,
  routeSharedNavigation,
} from "./sharedNavigation";
import { routeTerminalPanelToggle } from "../../features/terminal-panel";
import {
  leaveChangesWorkspace,
  useChangesWorkspace,
} from "../../features/agents/worktrees";
import { subscribeNativeTerminalChords } from "./nativeTerminalChords";
import type { TreeRow } from "../shell/ticket-workspace/tasks/TasksPane";
import { studioKeymapRegistry } from "./keymapRegistry";
import { useRestoreAndSelectModule } from "../../features/module-tabs";
import { routeTaskWorkspaceTabAction } from "../shell/ticket-workspace/selected-ticket/appNavigation";
import { routePlanKeyboardNavigation, usePlanWorkspace } from "../../features/sprints";

const EMPTY_TASK_ROWS: TreeRow[] = [];

function hasOpenModal(): boolean {
  return useModalStore.getState().modalStack.length > 0;
}

function isLaunchMenuTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    target.closest('[role="menu"][aria-label="Launch agent"]') !== null;
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function isChangesEntryActivation(event: KeyboardEvent): boolean {
  return (
    (event.key === "Enter" || event.key === " ") &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.target instanceof HTMLElement &&
    event.target.closest("[data-changes-keyboard-entry]") !== null
  );
}

function isWorkspaceTabNavigation(event: KeyboardEvent): boolean {
  return !hasModifier(event) &&
    ["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key) &&
    event.target instanceof HTMLElement &&
    event.target.closest('[data-workspace-tablist] [role="tab"]') !== null;
}

/** Installs the application-wide keyboard precedence and delegates actions. */
export function useGlobalKeymap(taskRows: TreeRow[] = EMPTY_TASK_ROWS): void {
  const taskRowsRef = useRef(taskRows);
  const restoreAndSelectModule = useRestoreAndSelectModule();
  const restoreAndSelectModuleRef = useRef(restoreAndSelectModule);

  useEffect(() => {
    taskRowsRef.current = taskRows;
  }, [taskRows]);

  useEffect(() => {
    restoreAndSelectModuleRef.current = restoreAndSelectModule;
  }, [restoreAndSelectModule]);

  useEffect(() => {
    function onCaptureKeyDown(event: KeyboardEvent): void {
      const ui = useClientStore.getState();
      const sidebarVisible = ui.sidebarVisible;
      const actionId = studioKeymapRegistry.resolve("capture", event);
      if (actionId === "modules.select-position-10") {
        event.preventDefault();
        event.stopPropagation();
      }
      if (hasOpenModal()) return;
      if (isLaunchMenuTarget(event.target)) return;
      if (isChangesEntryActivation(event)) return;
      if (isWorkspaceTabNavigation(event)) return;

      // Cmd+W must reach the selected run while its terminal owns typing.
      if (actionId === "close-tab") {
        routeSharedNavigation(event, taskRowsRef.current, actionId);
        if (event.defaultPrevented) event.stopImmediatePropagation();
        return;
      }

      // Ahead of body engagement: the panel toggle must reverse itself from any
      // focus position, including an agent terminal in typing mode (#667).
      if (routeTerminalPanelToggle(event, actionId)) return;
      if (routeModulePositionNavigation(event, actionId)) return;
      if (
        useChangesWorkspace.getState().active &&
        (actionId === "cycle-terminal-forward" ||
          actionId === "cycle-terminal-backward")
      ) {
        routeFullSidebarViewCaptureNavigation(
          event,
          taskRowsRef.current,
          actionId,
        );
        return;
      }
      // Changes owns its local keys before either planning layout sees them.
      // The focused control resolves its exact action through the same registry.
      if (useChangesWorkspace.getState().active) return;
      if (usePlanWorkspace.getState().active) return;
      if (
        actionId === "workspace-tab-next" ||
        actionId === "workspace-tab-previous"
      ) {
        routeTaskWorkspaceTabAction(event, actionId);
        return;
      }
      if (!sidebarVisible && routeThreeZoneBodyEngagement(event)) return;
      if (sidebarVisible) {
        routeFullSidebarViewCaptureNavigation(
          event,
          taskRowsRef.current,
          actionId,
        );
      } else {
        routeThreeZoneNavigation(event, taskRowsRef.current, actionId);
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (isWorkspaceTabNavigation(event)) return;
      const ui = useClientStore.getState();
      const sidebarVisible = ui.sidebarVisible;
      if (usePlanWorkspace.getState().active) {
        if (hasOpenModal() || event.defaultPrevented) return;
        // Bare Escape belongs to the Plan workspace even when focus is in an
        // editable field: first close its ticket detail, then leave Plan.
        if (event.key === "Escape" && !hasModifier(event)) {
          routePlanKeyboardNavigation(event);
          return;
        }
        if (isTypingTarget(event.target)) return;
        routePlanKeyboardNavigation(event);
        const globalAction = studioKeymapRegistry.resolve("global", event);
        if (globalAction === "settings") routeSharedNavigation(event, taskRowsRef.current, globalAction);
        return;
      }
      if (useChangesWorkspace.getState().active) {
        if (
          hasOpenModal() ||
          isTypingTarget(event.target) ||
          event.defaultPrevented
        ) {
          return;
        }
        // Every popup inside Changes (switcher, inspector, confirmations)
        // stops Escape itself, so an Escape that reaches here has nothing
        // left to close but the workspace.
        if (event.key === "Escape" && !hasModifier(event)) {
          event.preventDefault();
          leaveChangesWorkspace();
          requestAnimationFrame(() => {
            document.querySelector<HTMLButtonElement>(
              '[data-testid="workspace-tab-changes"]',
            )?.focus();
          });
          return;
        }
        const globalAction = studioKeymapRegistry.resolve("global", event);
        if (globalAction === "settings") {
          routeSharedNavigation(event, taskRowsRef.current, globalAction);
        }
        return;
      }
      if (!sidebarVisible && routeThreeZoneBodyEngagement(event)) return;
      const captureAction = studioKeymapRegistry.resolve("capture", event);
      if (
        captureAction &&
        (!sidebarVisible || !captureAction.startsWith("edit-view."))
      ) {
        return;
      }
      if (
        hasOpenModal() ||
        isTypingTarget(event.target) ||
        event.defaultPrevented
      ) {
        return;
      }
      const globalAction = studioKeymapRegistry.resolve("global", event);
      if (
        event.key === "Enter" &&
        event.metaKey &&
        !event.altKey &&
        !event.ctrlKey &&
        (globalAction === "normal-run-command" ||
          globalAction === "open-with-prompt-command")
      ) {
        routeSharedNavigation(event, taskRowsRef.current, globalAction);
        return;
      }
      if (
        sidebarVisible &&
        routeFullSidebarViewFocusedPaneNavigation(
          event,
          taskRowsRef.current,
          studioKeymapRegistry.resolve(
            "focused-pane",
            event,
            focusedPaneActionIds(ui.focusedPane),
          ),
          restoreAndSelectModuleRef.current,
        )
      ) {
        return;
      }
      routeSharedNavigation(
        event,
        taskRowsRef.current,
        globalAction,
      );
    }

    window.addEventListener("keydown", onCaptureKeyDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onCaptureKeyDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // The desktop build's native terminal owns the keyboard outright while it is
  // engaged, so the chords that must survive it arrive as host events rather
  // than keydowns (#684, #735). They are mounted here because this hook owns
  // their other keyboard entry point.
  useEffect(() => subscribeNativeTerminalChords(), []);
}
