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
import { subscribeNativeTerminalChords } from "./nativeTerminalChords";
import type { TreeRow } from "../shell/ticket-workspace/tasks/TasksPane";
import { studioKeymapRegistry } from "./keymapRegistry";
import { useRestoreAndSelectModule } from "../../features/module-tabs";
import { routeTaskWorkspaceTabAction } from "../shell/ticket-workspace/selected-ticket/appNavigation";

const EMPTY_TASK_ROWS: TreeRow[] = [];

function hasOpenModal(): boolean {
  return useModalStore.getState().modalStack.length > 0;
}

function isLaunchMenuTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    target.closest('[role="menu"][aria-label="Launch agent"]') !== null;
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
      if (hasOpenModal()) return;
      if (isLaunchMenuTarget(event.target)) return;

      const actionId = studioKeymapRegistry.resolve("capture", event);
      // Ahead of body engagement: the panel toggle must reverse itself from any
      // focus position, including an agent terminal in typing mode (#667).
      if (routeTerminalPanelToggle(event, actionId)) return;
      if (routeModulePositionNavigation(event, actionId)) return;
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
      const ui = useClientStore.getState();
      const sidebarVisible = ui.sidebarVisible;
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
        (globalAction === "open-agent-command" ||
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
