import { studioRuntime } from "../../runtime";
import { useAppUpdateCheckState } from "./internal/checkState";

export function useAppUpdates() {
  const runtime = studioRuntime();
  const status = useAppUpdateCheckState((state) => state.status);
  const installedVersion = useAppUpdateCheckState(
    (state) => state.installedVersion,
  );
  const availableVersion = useAppUpdateCheckState(
    (state) => state.availableVersion,
  );
  const notes = useAppUpdateCheckState((state) => state.notes);
  const errorMessage = useAppUpdateCheckState((state) => state.errorMessage);
  const check = useAppUpdateCheckState((state) => state.check);

  return {
    available: runtime.capabilities.appUpdates,
    availableVersion,
    check,
    errorMessage,
    installedVersion,
    notes,
    status,
  };
}
