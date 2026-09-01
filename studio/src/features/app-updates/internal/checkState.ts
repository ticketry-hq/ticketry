import studioPackage from "../../../../package.json";
import {
  AppUpdateOperationError,
  studioRuntime,
  type AppUpdateProgress,
} from "../../../runtime";
import { createApolloStore } from "../../../shared/apollo/localState";
import {
  initialUpdateState,
  transitionUpdate,
  type UpdateState,
} from "./updateMachine";

interface AppUpdateState {
  readonly state: UpdateState;
  readonly installedVersion: string;
  readonly launchCheckStarted: boolean;
  readonly check: () => Promise<void>;
  readonly checkOnceOnLaunch: () => Promise<void>;
  readonly updateAndRestart: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly recordProgress: (progress: AppUpdateProgress) => void;
  readonly applyUpdate: () => Promise<void>;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function failedEvent(error: unknown) {
  return {
    type: "operation-failed" as const,
    failureKind:
      error instanceof AppUpdateOperationError &&
      error.code === "update_signature_invalid"
        ? "signature-rejected" as const
        : "transient" as const,
    message: message(
      error,
      "The update could not be downloaded or installed. Retry the update.",
    ),
  };
}

export const useAppUpdateCheckState = createApolloStore<AppUpdateState>(
  "app-update-check",
  (set, get) => {
    const transition = (
      event: Parameters<typeof transitionUpdate>[1],
    ): void => {
      set((current) => ({
        state: transitionUpdate(current.state, event),
      }));
    };

    return {
      state: initialUpdateState,
      installedVersion: studioPackage.version,
      launchCheckStarted: false,

      async check() {
        transition({ type: "check-started" });
        try {
          const result = await studioRuntime().appUpdates.check();
          set({ installedVersion: result.installedVersion });
          if (result.status === "current") {
            transition({ type: "check-current" });
          } else if (result.availableVersion) {
            transition({
              type: "update-available",
              availableVersion: result.availableVersion,
              ...(result.notes === undefined ? {} : { notes: result.notes }),
            });
          } else {
            throw new Error("The update feed did not identify a version.");
          }
        } catch (error) {
          transition({
            type: "operation-failed",
            failureKind: "transient",
            message: message(
              error,
              "The update feed could not be reached. Retry the update check.",
            ),
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

      async applyUpdate() {
        try {
          await studioRuntime().appUpdates.downloadAndInstall();
          transition({ type: "download-completed" });
          await Promise.resolve();
          transition({ type: "installation-completed" });
          await studioRuntime().appUpdates.restart();
        } catch (error) {
          transition(failedEvent(error));
        }
      },

      async updateAndRestart() {
        transition({ type: "update-confirmed" });
        await get().applyUpdate();
      },

      async retry() {
        const current = get().state;
        if (current.status !== "failed") return;
        const retryTarget = current.retryTarget;
        transition({ type: "retry" });
        if (retryTarget === "check") {
          await get().check();
        } else {
          await get().applyUpdate();
        }
      },

      recordProgress(progress) {
        transition({
          type: "download-progress",
          receivedBytes: progress.receivedBytes,
          ...(progress.totalBytes === undefined
            ? {}
            : { totalBytes: progress.totalBytes }),
        });
      },
    };
  },
);
