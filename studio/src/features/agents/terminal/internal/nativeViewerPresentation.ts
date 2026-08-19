import { invoke } from "@tauri-apps/api/core";

// Presentation intent is per run. Distinct runs own distinct AppKit views and
// may be visible together (for example, an agent terminal above the module's
// bottom-panel shell). The shared queue still serializes calls into AppKit, but
// it must not turn keyboard focus's singularity into a one-viewer policy.
const desiredHandles = new Map<string, string>();
const visibleHandles = new Map<string, string>();
const intentRevisions = new Map<string, number>();
let presentationTail: Promise<void> = Promise.resolve();

function issueIntent(runId: string): number {
  const revision = (intentRevisions.get(runId) ?? 0) + 1;
  intentRevisions.set(runId, revision);
  return revision;
}

function intentIsCurrent(runId: string, revision: number): boolean {
  return intentRevisions.get(runId) === revision;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = presentationTail.catch(() => {}).then(operation);
  presentationTail = result.then(() => {}, () => {});
  return result;
}

/** Serializes a first attachment with every retained hide/show operation. */
export function attachNativeViewer<T extends { handle: string }>(
  attach: () => Promise<T | null>,
): Promise<{ status: T | null; presented: boolean }> {
  return enqueue(async () => {
    const status = await attach();
    // Native attach returns a prepared hidden handle. Only showNativeViewer may
    // commit presentation after the caller has acquired viewer authority.
    return { status, presented: false };
  });
}

/** Applies frame/show atomically with respect to every other retained viewer. */
export function showNativeViewer<T>(
  runId: string,
  handle: string,
  reveal: () => Promise<T | null>,
): Promise<T | null> {
  const revision = issueIntent(runId);
  desiredHandles.set(runId, handle);
  return enqueue(async () => {
    if (!intentIsCurrent(runId, revision)) return null;
    const previousHandle = visibleHandles.get(runId);
    if (previousHandle && previousHandle !== handle) {
      await invoke("native_terminal_hide", { handle: previousHandle });
      if (visibleHandles.get(runId) === previousHandle) {
        visibleHandles.delete(runId);
      }
    }
    if (!intentIsCurrent(runId, revision)) return null;
    const result = await reveal();
    // Handle identity is deliberately insufficient here. A close/reopen/close
    // sequence can return to the same retained handle while the first reveal
    // is still in flight; its geometry, owner, modal episode, and focus intent
    // are nevertheless stale. Every request carries a monotonic revision so
    // that ABA completion is hidden before the newest reveal may commit.
    if (!intentIsCurrent(runId, revision)) {
      await invoke("native_terminal_hide", { handle });
      if (visibleHandles.get(runId) === handle) visibleHandles.delete(runId);
      return null;
    }
    if (result === null) return null;
    visibleHandles.set(runId, handle);
    return result;
  });
}

/** Hides a viewer without detaching it or relinquishing its lease. */
export function hideNativeViewer(
  runId: string,
  handle: string | null,
): Promise<void> {
  const revision = issueIntent(runId);
  if (handle && desiredHandles.get(runId) === handle) {
    desiredHandles.delete(runId);
  }
  return enqueue(async () => {
    if (!handle || !intentIsCurrent(runId, revision)) return;
    await invoke("native_terminal_hide", { handle });
    if (visibleHandles.get(runId) === handle) visibleHandles.delete(runId);
  });
}

/** Removes a real teardown from presentation bookkeeping. */
export function forgetNativeViewer(runId: string, handle: string | null): void {
  issueIntent(runId);
  if (!handle || desiredHandles.get(runId) === handle) {
    desiredHandles.delete(runId);
  }
  if (!handle || visibleHandles.get(runId) === handle) {
    visibleHandles.delete(runId);
  }
}
