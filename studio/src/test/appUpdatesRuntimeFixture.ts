import type { AppUpdatesRuntime } from "../runtime";

/**
 * An App updates runtime for tests about something else entirely.
 *
 * It reports the running version as current and refuses to apply anything, so
 * a fixture runtime satisfies the contract without a test accidentally
 * depending on update behaviour it never exercises.
 */
export function quietAppUpdatesRuntime(): AppUpdatesRuntime {
  return {
    check: async () => ({ installedVersion: "0.0.0", status: "current" }),
    downloadAndInstall: async () => {
      throw new Error("This fixture runtime installs no updates.");
    },
    restart: async () => {
      throw new Error("This fixture runtime restarts nothing.");
    },
    subscribeProgress: () => () => {},
  };
}
