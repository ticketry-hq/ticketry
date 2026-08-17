import { useEffect, useRef, useSyncExternalStore } from "react";

import { nativeViewerSessionIsLive } from "./nativeViewerSessionLiveness";
import { useTerminalStore } from "./sessionStore";

type MountEntry = {
  token: symbol;
  handle: string | null;
  presentedBy: symbol | null;
  lifecycleStarted: boolean;
  fail: ((reason: string) => void) | null;
  teardown: (() => void) | null;
};

const entries = new Map<string, MountEntry>();
const listeners = new Set<() => void>();
const failedRuns = new Map<string, string>();
const hostCounts = new Map<string, number>();
let revision = 0;

function publish(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let sessionWatch: (() => void) | null = null;

/**
 * Retire a failed run's ledger entry once its session stops being live.
 *
 * Started on first use rather than at module scope. This module sits inside the
 * terminal barrel's import cycle (`sessionStore` → `state/clientStore` →
 * terminal barrel → `NativeGhosttyTerminal` → here → `sessionStore`), so which
 * edge is walked first decides whether `useTerminalStore` is initialised by the
 * time this file's body runs. Touching the store at module scope makes that
 * ordering load-bearing: any new import edge anywhere in the cycle can reorder
 * evaluation and turn this line into `Cannot read properties of undefined`.
 * Deferring the subscription costs nothing — the ledger it prunes cannot hold
 * anything until `failNativeViewerMount` has run at least once.
 */
function watchSessionLiveness(): void {
  if (sessionWatch) return;
  sessionWatch = useTerminalStore.subscribe((state) => {
    let changed = false;
    for (const runId of failedRuns.keys()) {
      const sessionId = state.sessionByRun[runId];
      const session = sessionId ? state.sessions[sessionId] : undefined;
      if (!session || !nativeViewerSessionIsLive(session.status)) {
        failedRuns.delete(runId);
        changed = true;
      }
    }
    if (changed) publish();
  });
}

/** Reserves one attachment lifecycle while every mounted host shares its handle. */
export function useNativeViewerMount(runId: string | null, retained: boolean) {
  const tokenRef = useRef(Symbol("native-viewer-mount"));
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => revision,
  );

  useEffect(() => {
    if (!runId || !retained) return;
    hostCounts.set(runId, (hostCounts.get(runId) ?? 0) + 1);
    return () => {
      const remaining = (hostCounts.get(runId) ?? 1) - 1;
      if (remaining > 0) {
        hostCounts.set(runId, remaining);
      } else {
        hostCounts.delete(runId);
        entries.get(runId)?.teardown?.();
      }
    };
  }, [retained, runId]);

  const entry = runId ? entries.get(runId) : undefined;
  return {
    token: tokenRef.current,
    mayOwnAttachment:
      !runId || (!failedRuns.has(runId) && (!entry || entry.token === tokenRef.current)),
    sharedHandle: entry?.handle ?? null,
    failureReason: runId ? failedRuns.get(runId) ?? null : null,
    presentedHere: entry?.presentedBy === tokenRef.current,
  };
}

export function startNativeViewerLifecycle(
  runId: string,
  token: symbol,
  fail: (reason: string) => void,
  teardown: () => void,
): boolean {
  let entry = entries.get(runId);
  if (failedRuns.has(runId)) return false;
  if (!entry) {
    entry = {
      token,
      handle: null,
      presentedBy: null,
      lifecycleStarted: false,
      fail: null,
      teardown: null,
    };
    entries.set(runId, entry);
  }
  if (entry.token !== token || entry.lifecycleStarted) return false;
  entry.lifecycleStarted = true;
  entry.fail = fail;
  entry.teardown = teardown;
  return true;
}

export function publishNativeViewerHandle(
  runId: string,
  token: symbol,
  handle: string,
  presented: boolean,
): void {
  const entry = entries.get(runId);
  if (!entry || entry.token !== token || entry.handle === handle) return;
  entry.handle = handle;
  entry.presentedBy = presented ? token : null;
  publish();
}

export function markNativeViewerPresented(runId: string, token: symbol): void {
  const entry = entries.get(runId);
  if (!entry || entry.presentedBy === token) return;
  entry.presentedBy = token;
  publish();
}

export function markNativeViewerHidden(runId: string, token: symbol): void {
  const entry = entries.get(runId);
  if (!entry || entry.presentedBy !== token) return;
  entry.presentedBy = null;
  publish();
}

export function releaseNativeViewerMount(runId: string, token: symbol): void {
  if (entries.get(runId)?.token !== token) return;
  entries.delete(runId);
  publish();
}

/** Stops new hosts from presenting a handle while its native detach is pending. */
export function beginNativeViewerRelease(runId: string, token: symbol): void {
  const entry = entries.get(runId);
  if (!entry || entry.token !== token || (!entry.handle && !entry.presentedBy)) {
    return;
  }
  entry.handle = null;
  entry.presentedBy = null;
  publish();
}

export function failNativeViewerMount(runId: string, reason: string): void {
  watchSessionLiveness();
  if (!failedRuns.has(runId)) {
    failedRuns.set(runId, reason);
    publish();
  }
  entries.get(runId)?.fail?.(reason);
}
