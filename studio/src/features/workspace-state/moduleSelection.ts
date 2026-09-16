import type { ClientState, SetWorkspaceState, GetWorkspaceState } from "./types";
import { getModuleFolder } from "../module-links";
import { useModalStore } from "../../app/modal/modalStore";
import { useStudioStore } from "../projects";
import { TEMP_TASK_ID } from "../agents/types";
import { writeRecentModule, clearRecentModule, readTaskSelections } from "../../state/persistence";
import { recordSelectionProfilePoint } from "../../shared/utilities/selectionProfile";

import { beginModuleLoad, moduleLoadPoint } from "../../shared/utilities/moduleLoadProbe";

import {
  beginTaskDetail,
  beginTaskDetailModuleInput,
  recordTaskSelection,
} from "../../shared/utilities/taskDetailProbe";

export function moduleSelectionActions(set: SetWorkspaceState, get: GetWorkspaceState): Pick<ClientState,
  | "selectModule"
  | "deselectModule"
  | "selectTask"
  | "toggleStateConfiguration"
  | "dismissStateConfiguration"
  | "toggleConversationConfiguration"
  | "dismissConversationConfiguration"
> {
  return {
    async selectModule(id) {
      const projectId = useStudioStore.getState().selectedProjectId;
      if (!projectId) return;
      if (!getModuleFolder(id)) {
        useModalStore.getState().pushModal({
          type: "module-folder",
          payload: { moduleId: id, resumeModuleSelection: true },
        });
        return;
      }
      beginTaskDetailModuleInput("module-selection");
      beginModuleLoad(id);
      const probe = moduleLoadPoint(id);
      set({
        selectedModuleId: id,
        selectedTaskId: null,
        workspaceSelection: { kind: "task" },
      });
      // The one client-local navigation value: which module this webview was
      // last working in. Nothing about the Module itself is written here.
      writeRecentModule(id);
      probe("selection-published");
      const { loadModuleTree } = await import("../work-items");
      probe("work-items-import-ready");
      const tree = await loadModuleTree(projectId, id);
      probe("selection-tree-ready", { task_count: tree.order.length });
      if (
        useStudioStore.getState().selectedProjectId !== projectId ||
        get().selectedModuleId !== id
      ) return;
      const rememberedTaskId = readTaskSelections()[id];
      const loadedTaskIds = new Set(tree.order);
      const isSelectableTaskId = (taskId: string) =>
        taskId === TEMP_TASK_ID || loadedTaskIds.has(taskId);
      const selectedTaskId = get().selectedTaskId;
      const restoredTaskId = selectedTaskId && isSelectableTaskId(selectedTaskId)
        ? selectedTaskId
        : rememberedTaskId && isSelectableTaskId(rememberedTaskId)
          ? rememberedTaskId
          : null;
      if (restoredTaskId !== selectedTaskId) beginTaskDetail(restoredTaskId, "module-restoration");
      probe("task-selection-restored", { task_id: restoredTaskId ?? "" });
      set({ selectedTaskId: restoredTaskId });
      get().setSidebarVisible(false);
      get().setFocusedPane("tasks");
    },

    deselectModule() {
      set({
        selectedModuleId: null,
        selectedTaskId: null,
        workspaceSelection: { kind: "task" },
      });
      clearRecentModule();
    },

    selectTask(id) {
      recordTaskSelection(id, "workspace-store");
      recordSelectionProfilePoint("store:select-task");
      set({ selectedTaskId: id, workspaceSelection: { kind: "task" } });
    },

    toggleStateConfiguration(projectId, stateId) {
      set((state) => ({
        workspaceSelection:
          state.workspaceSelection.kind === "state-configuration" &&
          state.workspaceSelection.projectId === projectId &&
          state.workspaceSelection.stateId === stateId
            ? { kind: "task" }
            : { kind: "state-configuration", projectId, stateId },
      }));
    },

    dismissStateConfiguration() {
      set({ workspaceSelection: { kind: "task" } });
    },

    toggleConversationConfiguration(projectId, moduleId) {
      set((state) => ({
        workspaceSelection:
          state.workspaceSelection.kind === "conversation-configuration" &&
          state.workspaceSelection.projectId === projectId &&
          state.workspaceSelection.moduleId === moduleId
            ? { kind: "task" }
            : { kind: "conversation-configuration", projectId, moduleId },
      }));
    },

    dismissConversationConfiguration() {
      set({ workspaceSelection: { kind: "task" } });
    },

  };
}
