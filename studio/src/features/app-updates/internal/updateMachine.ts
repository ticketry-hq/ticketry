export interface AvailableRelease {
  readonly availableVersion: string;
  readonly notes?: string;
}

export interface DownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly percent: number | null;
}

export type RetryTarget = "check" | "download";
export type UpdateFailureKind = "signature-rejected" | "transient";

export type UpdateState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "current" }
  | ({ readonly status: "ready-to-install" } & AvailableRelease)
  | ({
      readonly status: "downloading";
      readonly progress: DownloadProgress;
    } & AvailableRelease)
  | ({ readonly status: "installing" } & AvailableRelease)
  | ({ readonly status: "restart-requested" } & AvailableRelease)
  | ({
      readonly status: "failed";
      readonly failureKind: UpdateFailureKind;
      readonly message: string;
      readonly retryTarget: RetryTarget;
    } & Partial<AvailableRelease>);

export type UpdateEvent =
  | { readonly type: "check-started" }
  | { readonly type: "check-current" }
  | ({
      readonly type: "update-available";
    } & AvailableRelease)
  | { readonly type: "update-confirmed" }
  | ({
      readonly type: "download-progress";
      readonly receivedBytes: number;
      readonly totalBytes?: number;
    })
  | { readonly type: "download-completed" }
  | { readonly type: "installation-completed" }
  | {
      readonly type: "operation-failed";
      readonly failureKind: UpdateFailureKind;
      readonly message: string;
    }
  | { readonly type: "retry" };

export const initialUpdateState: UpdateState = { status: "idle" };

function releaseFrom(state: AvailableRelease): AvailableRelease {
  return {
    availableVersion: state.availableVersion,
    ...(state.notes === undefined ? {} : { notes: state.notes }),
  };
}

function downloading(release: AvailableRelease): UpdateState {
  return {
    status: "downloading",
    ...releaseFrom(release),
    progress: { receivedBytes: 0, totalBytes: null, percent: null },
  };
}

export function transitionUpdate(
  state: UpdateState,
  event: UpdateEvent,
): UpdateState {
  if (event.type === "check-started") return { status: "checking" };
  if (event.type === "check-current" && state.status === "checking") {
    return { status: "current" };
  }
  if (event.type === "update-available" && state.status === "checking") {
    return {
      status: "ready-to-install",
      ...releaseFrom(event),
    };
  }
  if (
    event.type === "update-confirmed" &&
    state.status === "ready-to-install"
  ) {
    return downloading(state);
  }
  if (event.type === "download-progress" && state.status === "downloading") {
    const totalBytes = event.totalBytes ?? null;
    const percent =
      totalBytes === null || totalBytes === 0
        ? null
        : Math.min(100, Math.max(0, (event.receivedBytes / totalBytes) * 100));
    return {
      ...state,
      progress: {
        receivedBytes: Math.max(0, event.receivedBytes),
        totalBytes,
        percent,
      },
    };
  }
  if (event.type === "download-completed" && state.status === "downloading") {
    return { status: "installing", ...releaseFrom(state) };
  }
  if (
    event.type === "installation-completed" &&
    state.status === "installing"
  ) {
    return { status: "restart-requested", ...releaseFrom(state) };
  }
  if (
    event.type === "operation-failed" &&
    (state.status === "checking" ||
      state.status === "downloading" ||
      state.status === "installing")
  ) {
    const hasRelease =
      state.status === "downloading" || state.status === "installing";
    const preserveRelease =
      hasRelease && event.failureKind !== "signature-rejected";
    return {
      status: "failed",
      failureKind: event.failureKind,
      message: event.message,
      retryTarget:
        event.failureKind === "signature-rejected" || !hasRelease
          ? "check"
          : "download",
      ...(preserveRelease ? releaseFrom(state) : {}),
    };
  }
  if (event.type === "retry" && state.status === "failed") {
    if (
      state.retryTarget === "download" &&
      typeof state.availableVersion === "string"
    ) {
      return downloading({
        availableVersion: state.availableVersion,
        ...(state.notes === undefined ? {} : { notes: state.notes }),
      });
    }
    return { status: "checking" };
  }
  return state;
}
