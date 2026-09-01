import studioPackage from "../../../../package.json";
import { AppUpdateOperationError, studioRuntime } from "../../../runtime";
import { createApolloStore } from "../../../shared/apollo/localState";
import {
  initialUpdateState,
  transitionUpdate,
  type UpdateEvent,
  type UpdateState,
} from "./updateMachine";

interface AppUpdateStoreState {
  /** The version this process is running, per the shipped package. */
  readonly installedVersion: string;
  readonly update: UpdateState;
  /** Whether this app process already made its one automatic feed contact. */
  readonly launchCheckStarted: boolean;
  readonly restartRequested: boolean;
  readonly dispatch: (event: UpdateEvent) => void;
  readonly check: () => Promise<void>;
  readonly checkOnceOnLaunch: () => Promise<void>;
  readonly installAndRestart: () => Promise<void>;
}

const UNREACHABLE_FEED = "The update feed could not be reached.";
const INSTALL_INTERRUPTED = "The update could not be installed.";

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function rejectedSignature(error: unknown): boolean {
  return (
    error instanceof AppUpdateOperationError &&
    error.code === "update_signature_invalid"
  );
}

/**
 * The one owner of update state for both the Settings section and the
 * availability indicator.
 *
 * Every transition goes through the state machine, so a launch check, a manual
 * check, and an install cannot disagree about what the user is looking at.
 */
export const useAppUpdateState = createApolloStore<AppUpdateStoreState>(
  "app-update",
  (set, get) => ({
    installedVersion: studioPackage.version,
    update: initialUpdateState,
    launchCheckStarted: false,
    restartRequested: false,

    dispatch(event) {
      set({ update: transitionUpdate(get().update, event) });
    },

    async check() {
      const { dispatch } = get();
      dispatch({ type: "check-started" });
      if (get().update.status !== "checking") return;
      try {
        const result = await studioRuntime().appUpdates.check();
        set({ installedVersion: result.installedVersion });
        if (result.status === "current") {
          dispatch({ type: "update-current" });
          return;
        }
        dispatch({
          type: "update-available",
          availableVersion: result.availableVersion ?? "",
          ...(result.notes === undefined ? {} : { notes: result.notes }),
        });
      } catch (error) {
        dispatch({
          type: "transient-failure",
          message: failureMessage(error, UNREACHABLE_FEED),
        });
      }
    },

    async checkOnceOnLaunch() {
      // One feed contact per app process: React remounts and strict-mode
      // double effects must not turn launch into two requests, and the browser
      // runtime never contacts the feed at all.
      if (get().launchCheckStarted || !studioRuntime().capabilities.appUpdates) {
        return;
      }
      set({ launchCheckStarted: true });
      await get().check();
    },

    async installAndRestart() {
      const runtime = studioRuntime();
      const { dispatch } = get();
      dispatch({ type: "install-confirmed" });
      if (get().update.status !== "downloading") return;

      const stopProgress = runtime.appUpdates.subscribeProgress((progress) => {
        get().dispatch({
          type: "download-progress",
          receivedBytes: progress.receivedBytes,
          ...(progress.totalBytes === undefined
            ? {}
            : { totalBytes: progress.totalBytes }),
        });
      });

      try {
        await runtime.appUpdates.downloadAndInstall();
      } catch (error) {
        dispatch(
          rejectedSignature(error)
            ? {
                type: "signature-rejected",
                message: failureMessage(error, INSTALL_INTERRUPTED),
              }
            : {
                type: "transient-failure",
                message: failureMessage(error, INSTALL_INTERRUPTED),
              },
        );
        return;
      } finally {
        stopProgress();
      }

      dispatch({ type: "installation-completed" });
      // Restart is the last step of one user-confirmed install, never a
      // spontaneous act: it happens once, only from the state installation
      // completed into.
      if (get().update.status !== "restart-requested" || get().restartRequested) {
        return;
      }
      set({ restartRequested: true });
      await runtime.appUpdates.restart();
    },
  }),
);
