const DISMISSED_RUNTIME_KEY = "ticketry.crash-notice.dismissed-runtime";

export function crashNoticeWasDismissed(runtimeInstance: string | undefined): boolean {
  if (!runtimeInstance) return false;
  try {
    return sessionStorage.getItem(DISMISSED_RUNTIME_KEY) === runtimeInstance;
  } catch {
    return false;
  }
}

export function dismissCrashNotice(runtimeInstance: string | undefined): void {
  if (!runtimeInstance) return;
  try {
    sessionStorage.setItem(DISMISSED_RUNTIME_KEY, runtimeInstance);
  } catch {
    // Storage failure must not keep the notice visible after dismissal.
  }
}
