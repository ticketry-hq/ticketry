import { useEffect } from "react";
import { useAppUpdateCheckState } from "./internal/checkState";

export function AppUpdatesLaunchCheck() {
  useEffect(() => {
    void useAppUpdateCheckState.getState().checkOnceOnLaunch();
  }, []);

  return null;
}
