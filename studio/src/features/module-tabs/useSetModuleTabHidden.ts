import { useCallback } from "react";

import { setModuleTabHidden } from "../projects/modulePresentationTransport";
import { useStudioStore } from "../projects/store";
import { apiErrorMessage } from "../../shared/api/errors";
import { toast } from "../../state/clientStore";

export function useSetModuleTabHidden() {
  const projectId = useStudioStore((state) => state.selectedProjectId);

  return useCallback(
    async (moduleId: string, tabHidden: boolean): Promise<boolean> => {
      if (!projectId) return false;
      try {
        await setModuleTabHidden(projectId, moduleId, tabHidden);
        return true;
      } catch (error) {
        toast.error(
          "Module tab could not be "
            + (tabHidden ? "hidden" : "restored")
            + ": "
            + apiErrorMessage(error),
        );
        return false;
      }
    },
    [projectId],
  );
}
