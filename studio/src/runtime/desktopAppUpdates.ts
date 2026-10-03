import {
  AppUpdateCheckError,
  AppUpdateOperationError,
  type AppUpdateOperationErrorCode,
  type AppUpdateProgress,
  type AppUpdateProgressListener,
  type AppUpdateCheckResult,
  type AppUpdatesRuntime,
} from "./contract";
import type { DesktopInvoke, DesktopRuntimeListen } from "./desktopRuntime";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
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
  throw new Error("Desktop initialization failed: update check result must match the stable channel update feed contract");
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
    return new AppUpdateCheckError(code, error.message);
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
  const code = error?.code;
  const retryable = code === "update_signature_invalid" ||
    code === "update_download_failed" || code === "update_operation_failed"
    ? retryabilityByCode[code] : undefined;
  if (
    error &&
    (code === "update_signature_invalid" ||
      code === "update_download_failed" || code === "update_operation_failed") &&
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
    typeof receivedBytes !== "number" ||
    !Number.isSafeInteger(receivedBytes) ||
    Number(receivedBytes) < 0 ||
    (totalBytes !== null &&
      totalBytes !== undefined &&
      (!Number.isSafeInteger(totalBytes) || Number(totalBytes) < 0))
  ) {
    return null;
  }
  return Object.freeze({
    receivedBytes,
    ...(typeof totalBytes === "number" ? { totalBytes } : {}),
  });
}

export function desktopAppUpdates(
  invoke: DesktopInvoke,
  listen?: DesktopRuntimeListen,
): AppUpdatesRuntime {
  return Object.freeze({
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
  });
}
