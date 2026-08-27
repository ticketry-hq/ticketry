export type NativeTerminalStatus = {
  handle: string;
  runId: string;
  columns: number;
  rows: number;
};

export type NativeTerminalFailure = {
  handle: string;
  runId: string;
  reason?: string;
};

export type NativeTerminalCompletion = {
  handle: string;
  runId: string;
  reason: "attachment_process_exited";
};

/**
 * The attach path refuses a host that clips to zero area against the viewport.
 * It travels through the same failure contract as a renderer error, so the
 * reason is named here and recognised at the recovery gate: zero geometry is a
 * layout condition that reproduces in whatever document a refresh creates.
 */
export const NATIVE_TERMINAL_HOST_NOT_VISIBLE =
  "native terminal host has no visible frame";

const VIEWER_OWNERSHIP_STORAGE_FAILURE = "viewer ownership storage failed:";

/** True when attachment never reached the renderer because its host had no frame. */
export function nativeFailureIsHostNotVisible(reason: string): boolean {
  return reason === NATIVE_TERMINAL_HOST_NOT_VISIBLE;
}

/**
 * Viewer lease persistence belongs to the Rust control plane, not the native
 * renderer. Reloading the WebView cannot repair it and can turn a transient
 * database lock into a reload loop, so the compatibility renderer stays up.
 */
export function nativeFailureIsViewerOwnershipStorage(reason: string): boolean {
  return reason.includes(VIEWER_OWNERSHIP_STORAGE_FAILURE);
}

export function nativeFailureMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "native terminal attachment failed";
}
