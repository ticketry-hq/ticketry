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
  useNativeViewerKeyboardOwnership,
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
import {
  publishRendererMeasurements,
  recordAttachStart,
  recordFirstPaint,
} from "./internal/rendererMeasurement";
import { activeElementLabel, traceViewerFocus } from "./internal/focusTrace";
import { useNativeWebViewSiblingInteraction } from "./internal/useNativeWebViewSiblingInteraction";

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
  // Any window-level overlay — modal stack or DialogHost confirm — takes
  // focus and keyboard ownership. The viewer stays presented beneath it as a
  // WebView sibling; only hide/show for surface ownership changes.
  const modalOpen = useModalOcclusionActive();
  const activeRef = useRef(active);
  const visibleRef = useRef(false);
  const openedRunRef = useRef<string | null>(null);
  const blockingHideCountRef = useRef(0);
  activeRef.current = active;
  // The one presentation gate, re-read at commit time by every queued show.
  const shouldPresentRef = useRef<() => boolean>(() => false);
  shouldPresentRef.current = () => visibleRef.current;

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

  // CODING-1304 — the default renderer records the attach latency half of the
  // comparison matrix. Bytes and paint duration have no JS-side equivalent
  // here: they never leave Rust and libghostty, which is the native
  // renderer's central advantage and shows in the matrix as an empty column.
  useEffect(() => {
    if (!runId) return;
    publishRendererMeasurements();
    recordAttachStart("native", runId);
  }, [runId]);

  useEffect(() => {
    if (presentedHere && visible && runId) recordFirstPaint("native", runId);
  }, [presentedHere, runId, visible]);

  useEffect(() => {
    if (failureReason) onUnavailable?.(failureReason);
  }, [failureReason, onUnavailable]);

  useEffect(() => {
    if (sharedHandle) onReady?.();
  }, [onReady, sharedHandle]);

  useNativeWebViewSiblingInteraction(
    sharedHandle,
    hostRef,
    visible && presentedHere,
    modalOpen,
    (error) => {
      if (runId) {
        failNativeViewerMount(runId, nativeFailureMessage(error), {
          origin: "webview-sibling-interaction",
          error,
        });
      }
    },
  );

  useNativeViewerFocusRegistration({
    sessionId,
    handle: sharedHandle,
    presented: presentedHere,
    visible,
    modalOpen,
  });
  useNativeViewerKeyboardOwnership({
    runId,
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
    onFailure: (error) => {
      if (runId) {
        failNativeViewerMount(runId, nativeFailureMessage(error), {
          origin: "frame-sync",
          error,
        });
      }
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
    const hidden = !visible;
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
    // A modal never hides: the viewer presents beneath it as a WebView sibling
    // and only surrenders focus and keyboard ownership.
    if (hidden && resolvedOwner !== owner) return;
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
          // Re-read presentation intent at commit time with the same gate the
          // lifecycle's first show uses. This closure is queued behind every
          // other retained hide/show, so a surface deactivated while it waited
          // cancels the reveal. An open modal does not: as a WebView sibling
          // the viewer presents beneath the dialog.
          if (!shouldPresentRef.current()) return null;
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
        failNativeViewerMount(runId, nativeFailureMessage(error), {
          origin: "visibility-change",
          error,
        });
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
      shouldPresent: () => shouldPresentRef.current(),
    });
  }, [mayOwnAttachment, retained, runId, sessionId, token]);

  const presentedElsewhere = session !== null && resolvedOwner !== owner;
  return (
    <div
      className="relative h-full w-full bg-transparent"
    >
      <div
        ref={hostRef}
        className="absolute bottom-0 left-2 right-2 top-[10px] bg-transparent"
        data-testid="native-terminal-host"
        data-terminal-renderer="libghostty"
        data-native-terminal-presented={visible && presentedHere ? "" : undefined}
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
