// The one liveness question the native viewer asks about a terminal session.
//
// Two native-viewer rules read the same answer: the mount registry drops a
// run's sticky failure once its session is no longer live, and Terminal's
// recovery gate only reports a native render failure while it still is. They
// must agree on the same status set — if one gains a status and the other does
// not, a dead session keeps booking Studio refreshes, or recovery silently
// stops working for a session that is still live.
//
// This is deliberately not presentation/terminalLiveness.ts: that predicate
// answers a run-state/colour question over a different state set. Keep the two
// separate.

const ENDED_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "exited",
  "error",
  "viewer_closed",
  "pty_eof",
  "session_lost",
]);

export function nativeViewerSessionIsLive(status: string): boolean {
  return !ENDED_SESSION_STATUSES.has(status);
}
