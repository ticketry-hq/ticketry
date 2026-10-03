import type { DirectoryTrustResult, StudioRuntime } from "./contract";
import type { DesktopInvoke } from "./desktopRuntime";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function validateDirectoryTrustResult(value: unknown): DirectoryTrustResult {
  const result = record(value);
  const status = result?.status;
  const approval = result?.approval;
  if (
    !result ||
    (status !== "already_trusted" && status !== "approval_required" &&
      status !== "denied" && status !== "unsupported" && status !== "prepared") ||
    (approval !== null && typeof approval !== "string") ||
    (result.directory !== undefined &&
      (typeof result.directory !== "string" || !result.directory)) ||
    (result.status === "approval_required" && !result.approval)
  ) {
    throw new Error("Desktop initialization failed: directory trust result must contain a known status and any required approval token");
  }
  return {
    status,
    approval,
    ...(typeof result.directory === "string"
      ? { directory: result.directory }
      : {}),
  };
}

export function desktopDirectoryTrust(
  invoke: DesktopInvoke,
): NonNullable<StudioRuntime["prepareDirectoryTrust"]> {
  return async (
    provider: string,
    directory: string,
    approval: string | null,
  ) =>
    validateDirectoryTrustResult(
      await invoke<unknown>("desktop_prepare_directory_trust", {
        provider,
        directory,
        approval,
      }),
    );
}
