import { useEffect } from "react";
import { studioRuntime } from "../../runtime";
import { useAppUpdateCheckState } from "./internal/checkState";

export function useAppUpdates() {
  const runtime = studioRuntime();
  const installedVersion = useAppUpdateCheckState(
    (updates) => updates.installedVersion,
  );
  const state = useAppUpdateCheckState((updates) => updates.state);
  const check = useAppUpdateCheckState((updates) => updates.check);
  const retry = useAppUpdateCheckState((updates) => updates.retry);
  const updateAndRestart = useAppUpdateCheckState(
    (updates) => updates.updateAndRestart,
  );

  useEffect(
    () => runtime.appUpdates.subscribeProgress((progress) => {
      useAppUpdateCheckState.getState().recordProgress(progress);
    }),
    [runtime],
  );

  return {
    available: runtime.capabilities.appUpdates,
    installedVersion,
    state,
    check,
    retry,
    updateAndRestart,
  };
}
