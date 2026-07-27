import { useEffect, useRef } from "react";
import { useModalStore } from "../modal/modalStore";
import { useUIStore } from "../../features/studio/stores/uiStore";
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
import { routeSharedNavigation } from "./sharedNavigation";
import type { Row } from "../../features/studio/pages/tasks/TasksPane";
import { studioKeymapRegistry } from "./keymapRegistry";

const EMPTY_TASK_ROWS: Row[] = [];

function hasOpenModal(
  ui: ReturnType<typeof useUIStore.getState>,
): boolean {
  return (
    ui.modalStack.length > 0 ||
    useModalStore.getState().modalStack.length > 0
  );
}

/** Installs the application-wide keyboard precedence and delegates actions. */
export function useGlobalKeymap(taskRows: Row[] = EMPTY_TASK_ROWS): void {
  const taskRowsRef = useRef(taskRows);

  useEffect(() => {
    taskRowsRef.current = taskRows;
  }, [taskRows]);

  useEffect(() => {
    function onCaptureKeyDown(event: KeyboardEvent): void {
      const ui = useUIStore.getState();
      if (hasOpenModal(ui)) return;
      if (!ui.sidebarVisible && routeThreeZoneBodyEngagement(event)) return;

      const actionId = studioKeymapRegistry.resolve("capture", event);
      if (ui.sidebarVisible) {
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
      const ui = useUIStore.getState();
      if (!ui.sidebarVisible && routeThreeZoneBodyEngagement(event)) return;
      const captureAction = studioKeymapRegistry.resolve("capture", event);
      if (
        captureAction &&
        (!ui.sidebarVisible || !captureAction.startsWith("edit-view."))
      ) {
        return;
      }
      if (
        hasOpenModal(ui) ||
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
        ui.sidebarVisible &&
        routeFullSidebarViewFocusedPaneNavigation(
          event,
          taskRowsRef.current,
          studioKeymapRegistry.resolve(
            "focused-pane",
            event,
            focusedPaneActionIds(ui.focusedPane),
          ),
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
}
