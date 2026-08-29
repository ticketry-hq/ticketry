import { useCallback } from "react";

import { useStudioStore } from "../projects/store";
import { useClientStore } from "../../state/clientStore";
import {
  getModulePresentationsSnapshot,
  hiddenModuleIds,
} from "./modulePresentation";
import { useSetModuleTabHidden } from "./useSetModuleTabHidden";

export function useRestoreAndSelectModule() {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const selectModule = useClientStore((state) => state.selectModule);
  const setTabHidden = useSetModuleTabHidden();

  return useCallback(
    (moduleId: string) => {
      const hiddenIds = hiddenModuleIds(
        getModulePresentationsSnapshot(projectId),
      );
      if (hiddenIds.has(moduleId)) {
        void setTabHidden(moduleId, false);
      }
      void selectModule(moduleId);
    },
    [projectId, selectModule, setTabHidden],
  );
}
