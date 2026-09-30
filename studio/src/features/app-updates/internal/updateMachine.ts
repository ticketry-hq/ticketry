/**
 * Every state the App updates section can be in, and the only transitions
 * between them.
 *
 * The states follow the runtime contract rather than an idealised installer:
 * `downloadAndInstall` is one operation reporting byte progress, so the flow is
 * available → downloading → restart-requested, with no separately observable
 * "downloaded but not installed" step. Guarding transitions here is what keeps
 * a late progress event from reviving a failed install, and what keeps restart
 * unreachable until installation actually completed.
 */

export interface IdleUpdateState {
  readonly status: "idle";
}

export interface CheckingUpdateState {
  readonly status: "checking";
}

export interface CurrentUpdateState {
  readonly status: "current";
}

export interface AvailableRelease {
  readonly availableVersion: string;
  readonly notes?: string;
}

export interface AvailableUpdateState extends AvailableRelease {
  readonly status: "available";
}

export interface DownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly percent: number | null;
}

export interface DownloadingUpdateState extends AvailableRelease {
  readonly status: "downloading";
  readonly progress: DownloadProgress;
}

export interface RestartRequestedUpdateState extends AvailableRelease {
  readonly status: "restart-requested";
}

export interface SignatureRejectedUpdateState {
  readonly status: "failed";
  readonly failureKind: "signature-rejected";
  readonly message: string;
  readonly retryTarget: "check";
}

export interface TransientInstallFailureState extends AvailableRelease {
  readonly status: "failed";
  readonly failureKind: "transient";
  readonly message: string;
  readonly retryTarget: "install";
}

export interface TransientCheckFailureState {
  readonly status: "failed";
  readonly failureKind: "transient";
  readonly message: string;
  readonly retryTarget: "check";
}

export type FailedUpdateState =
  | SignatureRejectedUpdateState
  | TransientInstallFailureState
  | TransientCheckFailureState;

export type UpdateState =
  | IdleUpdateState
  | CheckingUpdateState
  | CurrentUpdateState
  | AvailableUpdateState
  | DownloadingUpdateState
  | RestartRequestedUpdateState
  | FailedUpdateState;

export interface CheckStartedEvent {
  readonly type: "check-started";
}

export interface UpdateCurrentEvent {
  readonly type: "update-current";
}

export interface UpdateAvailableEvent {
  readonly type: "update-available";
  readonly availableVersion: string;
  readonly notes?: string;
}

export interface InstallConfirmedEvent {
  readonly type: "install-confirmed";
}

export interface DownloadProgressEvent {
  readonly type: "download-progress";
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

export interface InstallationCompletedEvent {
  readonly type: "installation-completed";
}

export interface SignatureRejectedEvent {
  readonly type: "signature-rejected";
  readonly message: string;
}

export interface TransientFailureEvent {
  readonly type: "transient-failure";
  readonly message: string;
}

export type UpdateEvent =
  | CheckStartedEvent
  | UpdateCurrentEvent
  | UpdateAvailableEvent
  | InstallConfirmedEvent
  | DownloadProgressEvent
  | InstallationCompletedEvent
  | SignatureRejectedEvent
  | TransientFailureEvent;

export const initialUpdateState: UpdateState = { status: "idle" };

const NO_PROGRESS: DownloadProgress = {
  receivedBytes: 0,
  totalBytes: null,
  percent: null,
};

function release(state: AvailableRelease): AvailableRelease {
  return {
    availableVersion: state.availableVersion,
    ...(state.notes === undefined ? {} : { notes: state.notes }),
  };
}

/** Whether the update is downloading or installing, so progress is expected. */
export function isApplyingUpdate(state: UpdateState): boolean {
  return state.status === "downloading";
}

export function transitionUpdate(
  state: UpdateState,
  event: UpdateEvent,
): UpdateState {
  // A check may be requested from any resting state, including after a failure
  // the user chose to retry.
  if (event.type === "check-started") {
    return state.status === "downloading" ||
      state.status === "restart-requested"
      ? state
      : { status: "checking" };
  }

  if (event.type === "update-current" && state.status === "checking") {
    return { status: "current" };
  }

  if (event.type === "update-available" && state.status === "checking") {
    return {
      status: "available",
      availableVersion: event.availableVersion,
      ...(event.notes === undefined ? {} : { notes: event.notes }),
    };
  }

  if (
    event.type === "install-confirmed" &&
    (state.status === "available" ||
      (state.status === "failed" && state.retryTarget === "install"))
  ) {
    return {
      status: "downloading",
      ...release(state),
      progress: NO_PROGRESS,
    };
  }

  if (event.type === "download-progress" && state.status === "downloading") {
    const totalBytes = event.totalBytes ?? null;
    return {
      ...state,
      progress: {
        receivedBytes: event.receivedBytes,
        totalBytes,
        percent:
          totalBytes === null || totalBytes === 0
            ? null
            : Math.min(
                100,
                Math.max(0, (event.receivedBytes / totalBytes) * 100),
              ),
      },
    };
  }

  if (
    event.type === "installation-completed" &&
    state.status === "downloading"
  ) {
    return { status: "restart-requested", ...release(state) };
  }

  if (event.type === "signature-rejected" && state.status === "downloading") {
    return {
      status: "failed",
      failureKind: "signature-rejected",
      message: event.message,
      retryTarget: "check",
    };
  }

  if (event.type === "transient-failure" && state.status === "downloading") {
    return {
      status: "failed",
      ...release(state),
      failureKind: "transient",
      message: event.message,
      retryTarget: "install",
    };
  }

  if (event.type === "transient-failure" && state.status === "checking") {
    return {
      status: "failed",
      failureKind: "transient",
      message: event.message,
      retryTarget: "check",
    };
  }

  return state;
}
