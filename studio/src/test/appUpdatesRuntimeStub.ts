import type { AppUpdatesRuntime } from "../runtime";

/** Inert app-updates runtime for tests that never exercise updating. */
export function stubAppUpdatesRuntime(): AppUpdatesRuntime {
  return {
    check: async () => ({ installedVersion: "0.0.0", status: "current" }),
    downloadAndInstall: async () => {},
    restart: async () => {},
    subscribeProgress: () => () => {},
  };
}
