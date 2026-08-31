export interface CheckingUpdateState {
  readonly status: "checking";
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

export interface ReadyToInstallUpdateState extends AvailableRelease {
  readonly status: "ready-to-install";
}

export interface InstallingUpdateState extends AvailableRelease {
  readonly status: "installing";
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

export interface TransientDownloadFailureState extends AvailableRelease {
  readonly status: "failed";
  readonly failureKind: "transient";
  readonly message: string;
  readonly retryTarget: "download";
}

export interface TransientCheckFailureState {
  readonly status: "failed";
  readonly failureKind: "transient";
  readonly message: string;
  readonly retryTarget: "check";
}

export type FailedUpdateState =
  | SignatureRejectedUpdateState
  | TransientDownloadFailureState
  | TransientCheckFailureState;

export type UpdateState =
  | CheckingUpdateState
  | AvailableUpdateState
  | DownloadingUpdateState
  | ReadyToInstallUpdateState
  | InstallingUpdateState
  | RestartRequestedUpdateState
  | FailedUpdateState;

export interface UpdateAvailableEvent {
  readonly type: "update-available";
  readonly availableVersion: string;
  readonly notes?: string;
}

export interface DownloadStartedEvent {
  readonly type: "download-started";
}

export interface DownloadProgressEvent {
  readonly type: "download-progress";
  readonly receivedBytes: number;
  readonly totalBytes?: number;
}

export interface DownloadCompletedEvent {
  readonly type: "download-completed";
}

export interface InstallConfirmedEvent {
  readonly type: "install-confirmed";
}

export interface InstallationCompletedEvent {
  readonly type: "installation-completed";
}

export interface SignatureRejectedEvent {
  readonly type: "signature-rejected";
}

export interface TransientFailureEvent {
  readonly type: "transient-failure";
  readonly message: string;
}

export interface RetryEvent {
  readonly type: "retry";
}

export type UpdateEvent =
  | UpdateAvailableEvent
  | DownloadStartedEvent
  | DownloadProgressEvent
  | DownloadCompletedEvent
  | InstallConfirmedEvent
  | InstallationCompletedEvent
  | SignatureRejectedEvent
  | TransientFailureEvent
  | RetryEvent;

export const initialUpdateState: UpdateState = { status: "checking" };

export function transitionUpdate(
  state: UpdateState,
  event: UpdateEvent,
): UpdateState {
  if (event.type === "update-available") {
    return {
      status: "available",
      availableVersion: event.availableVersion,
      ...(event.notes === undefined ? {} : { notes: event.notes }),
    };
  }

  if (event.type === "download-started" && state.status === "available") {
    return {
      ...state,
      status: "downloading",
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
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
          totalBytes === null
            ? null
            : Math.min(
                100,
                Math.max(0, (event.receivedBytes / totalBytes) * 100),
              ),
      },
    };
  }

  if (event.type === "download-completed" && state.status === "downloading") {
    return {
      status: "ready-to-install",
      availableVersion: state.availableVersion,
      ...(state.notes === undefined ? {} : { notes: state.notes }),
    };
  }

  if (event.type === "install-confirmed" && state.status === "ready-to-install") {
    return { ...state, status: "installing" };
  }

  if (event.type === "installation-completed" && state.status === "installing") {
    return { ...state, status: "restart-requested" };
  }

  if (event.type === "signature-rejected" && state.status === "installing") {
    return {
      status: "failed",
      failureKind: "signature-rejected",
      message: "Update rejected: invalid signature.",
      retryTarget: "check",
    };
  }

  if (event.type === "transient-failure" && state.status === "downloading") {
    return {
      status: "failed",
      availableVersion: state.availableVersion,
      ...(state.notes === undefined ? {} : { notes: state.notes }),
      failureKind: "transient",
      message: event.message,
      retryTarget: "download",
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

  if (
    event.type === "retry" &&
    state.status === "failed" &&
    state.retryTarget === "check"
  ) {
    return initialUpdateState;
  }

  if (
    event.type === "retry" &&
    state.status === "failed" &&
    state.retryTarget === "download"
  ) {
    return {
      status: "downloading",
      availableVersion: state.availableVersion,
      ...(state.notes === undefined ? {} : { notes: state.notes }),
      progress: { receivedBytes: 0, totalBytes: null, percent: null },
    };
  }

  return state;
}
