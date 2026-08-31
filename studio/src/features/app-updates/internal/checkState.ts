import studioPackage from "../../../../package.json";
import { studioRuntime } from "../../../runtime";
import { createApolloStore } from "../../../shared/apollo/localState";

export type AppUpdateCheckStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "failed";

interface AppUpdateCheckState {
  readonly status: AppUpdateCheckStatus;
  readonly installedVersion: string;
  readonly availableVersion?: string;
  readonly notes?: string;
  readonly errorMessage?: string;
  readonly launchCheckStarted: boolean;
  readonly check: () => Promise<void>;
  readonly checkOnceOnLaunch: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The update feed could not be reached.";
}

export const useAppUpdateCheckState = createApolloStore<AppUpdateCheckState>(
  "app-update-check",
  (set, get) => ({
    status: "idle",
    installedVersion: studioPackage.version,
    launchCheckStarted: false,

    async check() {
      set({ status: "checking", errorMessage: undefined });
      try {
        const result = await studioRuntime().appUpdates.check();
        if (result.status === "current") {
          set({
            status: "current",
            installedVersion: result.installedVersion,
            availableVersion: undefined,
            notes: undefined,
          });
          return;
        }
        set({
          status: "available",
          installedVersion: result.installedVersion,
          availableVersion: result.availableVersion,
          notes: result.notes,
        });
      } catch (error) {
        set({
          status: "failed",
          availableVersion: undefined,
          notes: undefined,
          errorMessage: errorMessage(error),
        });
      }
    },

    async checkOnceOnLaunch() {
      if (
        get().launchCheckStarted ||
        !studioRuntime().capabilities.appUpdates
      ) {
        return;
      }
      set({ launchCheckStarted: true });
      await get().check();
    },
  }),
);
