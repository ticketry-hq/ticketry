import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type RefObject } from "react";

import {
  notifyNativeTerminalKeyboardEngaged,
  registerNativeTerminalKeyboardOwner,
} from "../../../../runtime/nativeTerminalKeyboard";
import { clippedNativeTerminalFrame } from "./nativeTerminalFrame";
import { traceViewerFocus } from "./focusTrace";
import { registerTerminalFocus } from "./terminalRegistry";
import type { NativeTerminalStatus } from "./nativeViewerFailure";
import { selectNativeTerminalInput } from "./useNativeWebViewSiblingInteraction";

async function focusNativeInput(handle: string): Promise<void> {
  await selectNativeTerminalInput(handle);
  await invoke("native_terminal_focus", { handle });
}

// `native_terminal_focus` rejects a viewer whose reveal has not committed, and
// hides/shows are serialized through the presentation queue while focus is not.
// Both focus paths therefore wait for presentation rather than racing it.
export function useNativeViewerFocusRegistration({
  sessionId,
  handle,
  presented,
  visible,
  modalOpen,
}: {
  sessionId: string;
  handle: string | null;
  presented: boolean;
  visible: boolean;
  modalOpen: boolean;
}): void {
  useEffect(() => {
    if (!handle || !presented || !visible || modalOpen) return;
    return registerTerminalFocus(sessionId, () => {
      traceViewerFocus("focus requested by registry", { session: sessionId });
      notifyNativeTerminalKeyboardEngaged();
      void focusNativeInput(handle).catch((error) => {
        traceViewerFocus("focus request FAILED", {
          session: sessionId,
          error: String(error),
        });
      });
    });
  }, [handle, modalOpen, presented, sessionId, visible]);
}

export function useNativeViewerKeyboardOwnership({
  runId,
  handle,
  presented,
  visible,
  modalOpen,
}: {
  runId: string | null;
  handle: string | null;
  presented: boolean;
  visible: boolean;
  modalOpen: boolean;
}): void {
  useEffect(() => {
    if (!runId || !handle || !presented || !visible || modalOpen) return;
    return registerNativeTerminalKeyboardOwner({ handle, runId });
  }, [handle, modalOpen, presented, runId, visible]);
}

export function useNativeViewerFrameSync({
  handle,
  hostRef,
  activeRef,
  currentHandleRef,
  presented,
  visible,
  onFailure,
}: {
  handle: string | null;
  hostRef: RefObject<HTMLDivElement | null>;
  activeRef: RefObject<boolean>;
  currentHandleRef: RefObject<string | null>;
  presented: boolean;
  visible: boolean;
  onFailure: (error: unknown) => void;
}): void {
  const resizeFrameRef = useRef(0);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  useEffect(() => {
    const host = hostRef.current;
    // Geometry is observed only while this viewer is actually presented. A
    // retained-but-hidden viewer — deactivated, or still waiting for its
    // reveal to commit — has no on-screen frame to track, and pushing one
    // would resize a view the user cannot see. A modal is no reason to stop:
    // the viewer stays presented beneath it and must follow layout changes.
    if (!handle || !host || !presented || !visible) return;
    const scheduleFrame = () => {
      if (!activeRef.current || resizeFrameRef.current) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = 0;
        if (!activeRef.current || currentHandleRef.current !== handle) return;
        const frame = clippedNativeTerminalFrame(host);
        if (!frame) return;
        void invoke<NativeTerminalStatus>("native_terminal_set_frame", {
          handle,
          frame,
        }).catch((error) => failureRef.current(error));
      });
    };
    const observer = new ResizeObserver(scheduleFrame);
    observer.observe(host);
    window.addEventListener("resize", scheduleFrame);
    window.addEventListener("scroll", scheduleFrame, true);
    scheduleFrame();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleFrame);
      window.removeEventListener("scroll", scheduleFrame, true);
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = 0;
    };
  }, [activeRef, currentHandleRef, handle, hostRef, presented, visible]);
}

export function useNativeViewerFocusSignal({
  sessionId,
  handle,
  focusSignal,
  presented,
  visible,
  modalOpen,
}: {
  sessionId: string;
  handle: string | null;
  focusSignal?: number;
  presented: boolean;
  visible: boolean;
  modalOpen: boolean;
}): void {
  const handledFocusSignalRef = useRef(0);

  useEffect(() => {
    if (!handle || !presented || !visible || modalOpen) return;
    const pendingSignal =
      focusSignal !== undefined &&
      focusSignal !== 0 &&
      focusSignal !== handledFocusSignalRef.current;
    if (!pendingSignal) return;
    handledFocusSignalRef.current = focusSignal;
    traceViewerFocus("focus requested by signal", {
      session: sessionId,
      focusSignal,
    });
    notifyNativeTerminalKeyboardEngaged();
    void focusNativeInput(handle).catch((error) => {
      // A refused request must not spend the signal: releasing it lets the next
      // reveal of this viewer carry the same request through.
      if (handledFocusSignalRef.current === focusSignal) {
        handledFocusSignalRef.current = 0;
      }
      traceViewerFocus("focus request FAILED", {
        session: sessionId,
        focusSignal,
        error: String(error),
      });
    });
  }, [focusSignal, handle, modalOpen, presented, sessionId, visible]);
}
