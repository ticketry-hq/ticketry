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

/** True for the one failure reason that must never start a recovery campaign. */
export function nativeFailureIsHostNotVisible(reason: string): boolean {
  return reason === NATIVE_TERMINAL_HOST_NOT_VISIBLE;
}

export function nativeFailureMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "native terminal attachment failed";
}
