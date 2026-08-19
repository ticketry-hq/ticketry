import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useModalOcclusionActive } from "./internal/modalOcclusion";
import {
  foregroundKey,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./internal/foregroundStore";
import { useTerminalStore } from "./internal/sessionStore";
import { useTerminalOwnership } from "./internal/useTerminalOwnership";
import { clippedNativeTerminalFrame } from "./internal/nativeTerminalFrame";
import {
  hideNativeViewer,
  showNativeViewer,
} from "./internal/nativeViewerPresentation";
import {
  useNativeViewerFocusRegistration,
  useNativeViewerFocusSignal,
  useNativeViewerFrameSync,
} from "./internal/useNativeViewerHostEffects";
import {
  nativeFailureMessage,
  type NativeTerminalStatus,
} from "./internal/nativeViewerFailure";
import {
  failNativeViewerMount,
  markNativeViewerHidden,
  markNativeViewerPresented,
  useNativeViewerMount,
} from "./internal/nativeViewerMountRegistry";
import { ensureNativeViewerLifecycle } from "./internal/nativeViewerLifecycle";
import { reportNativeRenderSuccess } from "./internal/nativeRenderRecovery";
import { activeElementLabel, traceViewerFocus } from "./internal/focusTrace";

const OWNER_LABEL: Record<ForegroundOwner, string> = {
  studio: "the fallback workspace",
  drawer: "the issue drawer",
  panel: "the terminal panel",
};

export function NativeGhosttyTerminal({
  sessionId,
  owner,
  focusSignal,
  active = true,
  manageForegroundHost = true,
  onReady,
  onUnavailable,
  onVisibilityPendingChange,
}: {
  sessionId: string;
  owner: ForegroundOwner;
  focusSignal?: number;
  active?: boolean;
  manageForegroundHost?: boolean;
  onReady?: () => void;
  onUnavailable?: (reason: string) => void;
  onVisibilityPendingChange?: (runId: string, pending: boolean) => void;
}) {
  const sessions = useTerminalStore((state) => state.sessions);
  const registerHost = useTerminalForegroundStore((state) => state.registerHost);
  const unregisterHost = useTerminalForegroundStore((state) => state.unregisterHost);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Any window-level overlay — modal stack or DialogHost confirm — occludes.
  const modalOpen = useModalOcclusionActive();
  const modalOpenRef = useRef(modalOpen);
  const activeRef = useRef(active);
  const visibleRef = useRef(false);
  const openedRunRef = useRef<string | null>(null);
  const blockingHideCountRef = useRef(0);
  modalOpenRef.current = modalOpen;
  activeRef.current = active;

  const session = sessions[sessionId] ?? null;
  const runId = session?.agentRunId ?? null;
  const key = session ? foregroundKey(session) : null;
  const { acquire, resolvedOwner } = useTerminalOwnership(key, owner);
  if (active && runId) openedRunRef.current = runId;
  const retained = !!runId && openedRunRef.current === runId;
  const {
    token,
    mayOwnAttachment,
    sharedHandle,
    failureReason,
    presentedHere,
  } = useNativeViewerMount(runId, retained);
  const visible = retained && active && resolvedOwner === owner;
  visibleRef.current = visible;
  const presentedHandleRef = useRef<string | null>(sharedHandle);
  presentedHandleRef.current = sharedHandle;

  useEffect(() => {
    if (failureReason) onUnavailable?.(failureReason);
  }, [failureReason, onUnavailable]);

  useEffect(() => {
    if (sharedHandle) onReady?.();
  }, [onReady, sharedHandle]);

  // Recovery succeeds on presentation evidence only: this host is the visible
  // one and its native show committed a non-empty grid. Holding a handle for a
  // hidden retained viewer is not a working native terminal. Success retires
  // this run alone — another run's failure keeps its own campaign armed.
  useEffect(() => {
    if (presentedHere && visible && runId) reportNativeRenderSuccess(runId);
  }, [presentedHere, runId, visible]);

  useNativeViewerFocusRegistration({
    sessionId,
    handle: sharedHandle,
    presented: presentedHere,
    visible,
    modalOpen,
  });
  useNativeViewerFrameSync({
    handle: sharedHandle,
    hostRef,
    activeRef,
    currentHandleRef: presentedHandleRef,
    presented: presentedHere,
    visible,
    modalOpen,
    onFailure: (error) => {
      console.error("native libghostty frame update failed", error);
      if (runId) failNativeViewerMount(runId, nativeFailureMessage(error));
    },
  });
  useNativeViewerFocusSignal({
    sessionId,
    handle: sharedHandle,
    focusSignal,
    presented: presentedHere,
    visible,
    modalOpen,
  });

  useLayoutEffect(() => {
    const handle = sharedHandle;
    if (!retained || !runId) return;
    const hidden = !visible || modalOpen;
    if (!handle) return;
    traceViewerFocus(hidden ? "wants hidden" : "wants presented", {
      run: runId,
      active,
      visible,
      modalOpen,
      resolvedOwner,
      presentedHere,
      activeElement: activeElementLabel(),
    });
    // The destination host moves the one shared view. The prior host must not
    // race that move with a hide merely because foreground ownership changed.
    // Modal occlusion is window-level and has no destination host: while the
    // stack is non-empty nobody may present, so the deferral would otherwise
    // leave the losing host's view uncovered over the dialog.
    if (hidden && !modalOpen && resolvedOwner !== owner) return;
    if (hidden && !presentedHere) return;
    if (!hidden && presentedHere) return;
    const blocksDestination = hidden && !active && !modalOpen;
    if (blocksDestination) {
      blockingHideCountRef.current += 1;
      onVisibilityPendingChange?.(runId, true);
    }
    const command = hidden
      ? hideNativeViewer(runId, handle).then(() => {
          markNativeViewerHidden(runId, token);
          return null;
        })
      : showNativeViewer(runId, handle, async () => {
          // Re-read presentation intent at commit time. This closure is queued
          // behind every other retained hide/show, so a modal opened (or the
          // surface deactivated) while it waited must cancel the reveal rather
          // than uncover a native island over the dialog.
          if (modalOpenRef.current || !visibleRef.current) return null;
          const host = hostRef.current;
          if (!host) return null;
          const frame = clippedNativeTerminalFrame(host);
          if (!frame) return null;
          const status = await invoke<NativeTerminalStatus>(
            "native_terminal_show",
            { handle, frame },
          );
          if (status.columns <= 0 || status.rows <= 0) {
            throw new Error("native terminal renderer returned an empty grid");
          }
          return status;
        }).then((status) => {
          if (status) markNativeViewerPresented(runId, token);
          return status;
        });
    void command
      .catch((error) => {
        console.error("native libghostty visibility change failed", error);
        failNativeViewerMount(runId, nativeFailureMessage(error));
      })
      .finally(() => {
        if (!blocksDestination) return;
        blockingHideCountRef.current -= 1;
        if (blockingHideCountRef.current === 0) {
          onVisibilityPendingChange?.(runId, false);
        }
      });
  }, [
    active,
    modalOpen,
    onVisibilityPendingChange,
    owner,
    presentedHere,
    resolvedOwner,
    retained,
    runId,
    sharedHandle,
    token,
    visible,
  ]);

  useEffect(() => {
    if (manageForegroundHost && active) registerHost(owner, hostRef.current);
    return () => {
      if (manageForegroundHost && active) unregisterHost(owner);
    };
  }, [
    active,
    manageForegroundHost,
    owner,
    registerHost,
    unregisterHost,
  ]);

  useEffect(() => {
    if (!retained || !runId || !mayOwnAttachment) return;
    ensureNativeViewerLifecycle({
      runId,
      sessionId,
      token,
      host: () => hostRef.current,
      shouldPresent: () => visibleRef.current && !modalOpenRef.current,
    });
  }, [mayOwnAttachment, retained, runId, sessionId, token]);

  const presentedElsewhere = session !== null && resolvedOwner !== owner;
  return (
    <div className="relative h-full w-full bg-pane-panel">
      <div
        ref={hostRef}
        className="absolute bottom-0 left-2 right-2 top-[10px] bg-pane-panel"
        data-testid="native-terminal-host"
        data-terminal-renderer="libghostty"
      />
      {presentedElsewhere && resolvedOwner ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pane-bg p-4 text-center text-sm text-text-muted">
          <p>This terminal is open in {OWNER_LABEL[resolvedOwner]}.</p>
          <button
            type="button"
            onClick={() => key && acquire(key, owner)}
            className="border border-pane-border px-3 py-1 text-sm text-text-primary hover:bg-pane-title"
          >
            View here
          </button>
        </div>
      ) : null}
    </div>
  );
}
