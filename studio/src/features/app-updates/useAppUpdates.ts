import { studioRuntime } from "../../runtime";
import { useAppUpdateState } from "./internal/updateState";
import type { UpdateState } from "./internal/updateMachine";

export interface AppUpdatesView {
  /** Whether this platform installs its own updates at all. */
  readonly available: boolean;
  readonly installedVersion: string;
  readonly update: UpdateState;
  readonly check: () => Promise<void>;
  readonly installAndRestart: () => Promise<void>;
}

export function useAppUpdates(): AppUpdatesView {
  const runtime = studioRuntime();
  const installedVersion = useAppUpdateState((state) => state.installedVersion);
  const update = useAppUpdateState((state) => state.update);
  const check = useAppUpdateState((state) => state.check);
  const installAndRestart = useAppUpdateState(
    (state) => state.installAndRestart,
  );

  return {
    available: runtime.capabilities.appUpdates,
    check,
    installAndRestart,
    installedVersion,
    update,
  };
}
