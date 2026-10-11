import { useModuleNavigation } from "./useModuleNavigation";

/** Only explicitly labeled Restore-and-select entry points use this adapter. */
export function useRestoreAndSelectModule() {
  return useModuleNavigation().restoreAndSelectModule;
}
