import { useEffect, useRef, useSyncExternalStore } from "react";

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

function nativeViewerSessionIsLive(status: string): boolean {
  return ![
    "exited",
    "error",
    "viewer_closed",
    "pty_eof",
    "session_lost",
  ].includes(status);
}

useTerminalStore.subscribe((state) => {
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
  if (!failedRuns.has(runId)) {
    failedRuns.set(runId, reason);
    publish();
  }
  entries.get(runId)?.fail?.(reason);
}
