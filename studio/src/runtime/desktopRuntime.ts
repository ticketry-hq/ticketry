import type {
  RuntimeStartupConfiguration,
  CrashCollectionOutcome,
  ServiceHealth,
  ServiceHealthListener,
  StudioRuntime,
  UserNoticeListener,
} from "./contract";
import {
  AppUpdateCheckError,
  AppUpdateOperationError,
  type AppUpdateOperationErrorCode,
  type AppUpdateProgress,
  type AppUpdateProgressListener,
  type AppUpdateCheckErrorCode,
  type AppUpdateCheckResult,
} from "./contract";
import {
  executeGraphQlTransport,
  type CreateGraphQlTransportProxy,
} from "./graphQlTransport";
import { createTauRPCProxy } from "../graphql-foundation/generated/taurpc";
import { desktopDocumentUrl } from "./documentAssetUrl";
import {
  validateUserNotice,
  validateUserNotices,
} from "./userNotice";

type DesktopCommand =
  | "desktop_runtime_configuration"
  | "desktop_retry_services"
  | "desktop_pick_folder"
  | "desktop_update_check"
  | "desktop_update_download_and_install"
  | "desktop_update_restart"
  | "desktop_latest_crash_collection_outcome"
  | "desktop_reveal_crash_report_folder";

export type DesktopInvoke = <T>(command: DesktopCommand) => Promise<T>;
export type DesktopRuntimeListen = (
  event:
    | "desktop-service-health"
    | "desktop-user-notice"
    | "desktop-update-progress",
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

export interface DesktopRuntimeOptions {
  readonly invoke: DesktopInvoke;
  readonly listen?: DesktopRuntimeListen;
  readonly createGraphQlProxy?: CreateGraphQlTransportProxy;
}

function initializationError(field: string, expectation: string): never {
  throw new Error(`Desktop initialization failed: ${field} ${expectation}`);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function validatePickedFolder(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value === "string" &&
    (value.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(value) ||
      value.startsWith("\\\\"))
  ) {
    return value;
  }
  return initializationError(
    "picked folder",
    "must be an absolute path or null",
  );
}

function validateAppUpdateCheckResult(value: unknown): AppUpdateCheckResult {
  const result = record(value);
  if (
    result?.status === "current" &&
    typeof result.installed_version === "string"
  ) {
    return Object.freeze({
      installedVersion: result.installed_version,
      status: "current",
    });
  }
  if (
    result?.status === "available" &&
    typeof result.installed_version === "string" &&
    typeof result.available_version === "string" &&
    (typeof result.notes === "string" || result.notes === undefined)
  ) {
    return Object.freeze({
      installedVersion: result.installed_version,
      status: "available",
      availableVersion: result.available_version,
      ...(typeof result.notes === "string" ? { notes: result.notes } : {}),
    });
  }
  return initializationError(
    "update check result",
    "must match the stable channel update feed contract",
  );
}

function validateCrashCollectionOutcome(value: unknown): CrashCollectionOutcome {
  const outcome = record(value);
  if (outcome?.status === "none" || outcome?.status === "report_collected") {
    return Object.freeze({ status: outcome.status });
  }
  return initializationError(
    "Crash Report collection outcome",
    "must be none or report_collected",
  );
}

function appUpdateCheckError(value: unknown): AppUpdateCheckError {
  const error = record(value);
  const code = error?.code;
  if (
    error &&
    (code === "update_feed_unreachable" ||
      code === "update_manifest_invalid") &&
    typeof error.message === "string" &&
    error.message.length > 0 &&
    error.retryable === true
  ) {
    return new AppUpdateCheckError(code as AppUpdateCheckErrorCode, error.message);
  }
  return new AppUpdateCheckError(
    "update_check_failed",
    "The stable channel update check failed. Retry the update check.",
  );
}

function appUpdateOperationError(value: unknown): AppUpdateOperationError {
  const error = record(value);
  const retryabilityByCode: Readonly<
    Record<AppUpdateOperationErrorCode, boolean>
  > = {
    update_signature_invalid: false,
    update_download_failed: true,
    update_operation_failed: true,
  };
  const code = error?.code as AppUpdateOperationErrorCode;
  const retryable = retryabilityByCode[code];
  if (
    error &&
    typeof retryable === "boolean" &&
    typeof error.message === "string" &&
    error.message.length > 0 &&
    error.retryable === retryable
  ) {
    return new AppUpdateOperationError(code, error.message, retryable);
  }
  return new AppUpdateOperationError(
    "update_operation_failed",
    "The update could not be downloaded or installed. Retry the update.",
    true,
  );
}

function appUpdateProgress(value: unknown): AppUpdateProgress | null {
  const progress = record(value);
  const receivedBytes = progress?.received_bytes;
  const totalBytes = progress?.total_bytes;
  if (
    !Number.isSafeInteger(receivedBytes) ||
    Number(receivedBytes) < 0 ||
    (totalBytes !== null &&
      totalBytes !== undefined &&
      (!Number.isSafeInteger(totalBytes) || Number(totalBytes) < 0))
  ) {
    return null;
  }
  return Object.freeze({
    receivedBytes: receivedBytes as number,
    ...(typeof totalBytes === "number" ? { totalBytes } : {}),
  });
}

function validateConfiguration(value: unknown): RuntimeStartupConfiguration {
  const configuration = record(value);
  const serviceHealth = record(configuration?.serviceHealth);
  if (!configuration || !serviceHealth) {
    return initializationError("configuration", "must include serviceHealth");
  }
  if (
    configuration.runtimeInstance !== undefined &&
    (typeof configuration.runtimeInstance !== "string" || configuration.runtimeInstance.length === 0)
  ) {
    return initializationError("configuration.runtimeInstance", "must be a non-empty string when present");
  }
  const state = serviceHealth.state;
  if (![
    "starting",
    "migrating",
    "ready",
    "recovering",
    "degraded",
    "failed",
  ].includes(String(state))) {
    return initializationError("serviceHealth.state", "must be a stable service-health state");
  }
  for (const field of ["service", "message", "logPointer"] as const) {
    if (serviceHealth[field] !== null && typeof serviceHealth[field] !== "string") {
      return initializationError(`serviceHealth.${field}`, "must be a string or null");
    }
  }

  return Object.freeze({
    runtimeInstance: configuration.runtimeInstance as string | undefined,
    serviceHealth: Object.freeze({
      state: state as RuntimeStartupConfiguration["serviceHealth"]["state"],
      service: serviceHealth.service as string | null,
      message: serviceHealth.message as string | null,
      logPointer: serviceHealth.logPointer as string | null,
    }),
    initialNotices: validateUserNotices(configuration.initialNotices),
  });
}

function serviceHealth(value: unknown): ServiceHealth | null {
  const recordValue = record(value);
  if (!recordValue) return null;
  const state = recordValue.state;
  if (!["starting", "migrating", "ready", "recovering", "degraded", "failed"].includes(String(state))) return null;
  for (const field of ["service", "message", "logPointer"] as const) {
    if (recordValue[field] !== null && typeof recordValue[field] !== "string") return null;
  }
  return {
    state: state as ServiceHealth["state"],
    service: recordValue.service as string | null,
    message: recordValue.message as string | null,
    logPointer: recordValue.logPointer as string | null,
  };
}

/** Load the desktop-only startup values before the shared Studio mounts. */
export async function createDesktopRuntime({
  invoke,
  listen,
  createGraphQlProxy = createTauRPCProxy,
}: DesktopRuntimeOptions): Promise<StudioRuntime> {
  const startup = validateConfiguration(
    await invoke<unknown>("desktop_runtime_configuration"),
  );
  const deliveredNoticeIds = new Set(
    startup.initialNotices.map((notice) => notice.id),
  );
  const readWorkTracker: StudioRuntime["readWorkTracker"] = (routes) =>
    routes.graphQl((document, variables) => executeGraphQlTransport(
      document,
      variables,
      createGraphQlProxy,
    ));

  return Object.freeze({
    platform: "desktop" as const,
    graphQlTransport: createGraphQlProxy,
    capabilities: Object.freeze({
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
      appUpdates: true,
    }),
    readWorkTracker,
    writeWorkTracker: readWorkTracker,
    readSettings: readWorkTracker,
    writeSettings: readWorkTracker,
    statusStream: () => createGraphQlProxy,
    documentUrl: (documentId: string, relPath: string) =>
      desktopDocumentUrl(documentId, relPath),
    appUpdates: Object.freeze({
      check: async () => {
        try {
          return validateAppUpdateCheckResult(
            await invoke<unknown>("desktop_update_check"),
          );
        } catch (error) {
          if (error instanceof AppUpdateCheckError) throw error;
          throw appUpdateCheckError(error);
        }
      },
      downloadAndInstall: async () => {
        try {
          await invoke<void>("desktop_update_download_and_install");
        } catch (error) {
          throw appUpdateOperationError(error);
        }
      },
      restart: async () => {
        await invoke<void>("desktop_update_restart");
      },
      subscribeProgress: (listener: AppUpdateProgressListener) => {
        if (!listen) return () => {};
        let active = true;
        let unlisten: (() => void) | undefined;
        void listen("desktop-update-progress", (event) => {
          const progress = appUpdateProgress(event.payload);
          if (active && progress) listener(progress);
        }).then((stop) => {
          unlisten = stop;
          if (!active) stop();
        });
        return () => {
          active = false;
          unlisten?.();
        };
      },
    }),
    crashReports: Object.freeze({
      latestCollectionOutcome: async () =>
        validateCrashCollectionOutcome(
          await invoke<unknown>("desktop_latest_crash_collection_outcome"),
        ),
      revealFolder: async () => {
        await invoke<void>("desktop_reveal_crash_report_folder");
      },
    }),
    pickFolder: async () =>
      validatePickedFolder(await invoke<unknown>("desktop_pick_folder")),
    retryServices: async () => {
      await invoke<void>("desktop_retry_services");
    },
    startup: () => startup,
    subscribeServiceHealth: (listener: ServiceHealthListener) => {
      listener(startup.serviceHealth);
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-service-health", (event) => {
        const health = serviceHealth(event.payload);
        if (active && health) listener(health);
      }).then((stop) => {
        unlisten = stop;
        if (!active) stop();
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
    subscribeUserNotices: (listener: UserNoticeListener) => {
      if (!listen) return () => {};
      let active = true;
      let unlisten: (() => void) | undefined;
      void listen("desktop-user-notice", (event) => {
        const notice = validateUserNotice(event.payload);
        if (!active || !notice || deliveredNoticeIds.has(notice.id)) return;
        deliveredNoticeIds.add(notice.id);
        listener(notice);
      }).then((stop) => {
        unlisten = stop;
        if (!active) stop();
      });
      return () => {
        active = false;
        unlisten?.();
      };
    },
  });
}
