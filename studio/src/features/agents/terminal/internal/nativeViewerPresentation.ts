import { invoke } from "@tauri-apps/api/core";

type VisibleViewer = {
  runId: string;
  handle: string;
};

let desiredRunId: string | null = null;
let visibleViewer: VisibleViewer | null = null;
let presentationTail: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = presentationTail.catch(() => {}).then(operation);
  presentationTail = result.then(() => {}, () => {});
  return result;
}

async function hideCurrentViewer(nextRunId: string): Promise<void> {
  const current = visibleViewer;
  if (!current || current.runId === nextRunId) return;
  await invoke("native_terminal_hide", { handle: current.handle });
  if (visibleViewer?.handle === current.handle) visibleViewer = null;
}

/** Serializes a first attachment with every retained hide/show operation. */
export function attachNativeViewer<T extends { handle: string }>(
  runId: string,
  attach: () => Promise<T | null>,
): Promise<{ status: T | null; presented: boolean }> {
  desiredRunId = runId;
  return enqueue(async () => {
    if (desiredRunId === runId) await hideCurrentViewer(runId);
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
  desiredRunId = runId;
  return enqueue(async () => {
    if (desiredRunId !== runId) return null;
    await hideCurrentViewer(runId);
    if (desiredRunId !== runId) return null;
    const result = await reveal();
    if (desiredRunId !== runId) {
      await invoke("native_terminal_hide", { handle });
      if (visibleViewer?.handle === handle) visibleViewer = null;
      return null;
    }
    if (result === null) return null;
    visibleViewer = { runId, handle };
    return result;
  });
}

/** Hides a viewer without detaching it or relinquishing its lease. */
export function hideNativeViewer(
  runId: string,
  handle: string | null,
): Promise<void> {
  if (desiredRunId === runId) desiredRunId = null;
  return enqueue(async () => {
    if (desiredRunId === runId || !handle) return;
    await invoke("native_terminal_hide", { handle });
    if (visibleViewer?.handle === handle) visibleViewer = null;
  });
}

/** Removes a real teardown from presentation bookkeeping. */
export function forgetNativeViewer(runId: string, handle: string | null): void {
  if (desiredRunId === runId) desiredRunId = null;
  if (
    visibleViewer?.runId === runId &&
    (!handle || visibleViewer.handle === handle)
  ) {
    visibleViewer = null;
  }
}
