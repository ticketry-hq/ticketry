import { useEffect } from "react";
import { useAppUpdateState } from "./internal/updateState";

/** Performs this app process's one automatic update check after startup. */
export function AppUpdatesLaunchCheck() {
  useEffect(() => {
    void useAppUpdateState.getState().checkOnceOnLaunch();
  }, []);

  return null;
}
