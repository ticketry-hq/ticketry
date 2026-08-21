import { useCallback } from "react";

import { useClientStore } from "../../state/clientStore";
import type { ModulePresentation } from "../../shared/api/types";
import { queryKeys } from "../../shared/query/keys";
import { queryClient } from "../../shared/query/queryClient";
import { useSetModuleTabHidden } from "./mutations";
import { hiddenModuleIds } from "./queries";

/** Restore a hidden Module tab when needed, then select the Module. */
export function useRestoreAndSelectModule() {
  const { mutate: setTabHidden } = useSetModuleTabHidden();
  const selectModule = useClientStore((state) => state.selectModule);

  return useCallback(
    (moduleId: string) => {
      const hiddenIds = hiddenModuleIds(
        queryClient.getQueryData<ModulePresentation[]>(
          queryKeys.modulePresentations.all,
        ),
      );
      if (hiddenIds.has(moduleId)) {
        setTabHidden({ moduleId, tabHidden: false });
      }
      void selectModule(moduleId);
    },
    [selectModule, setTabHidden],
  );
}
