import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type RefObject } from "react";

import { clippedNativeTerminalFrame } from "./nativeTerminalFrame";
import { registerTerminalFocus } from "./terminalRegistry";
import type { NativeTerminalStatus } from "./nativeViewerFailure";

export function useNativeViewerFocusRegistration({
  sessionId,
  handle,
  visible,
  modalOpen,
}: {
  sessionId: string;
  handle: string | null;
  visible: boolean;
  modalOpen: boolean;
}): void {
  useEffect(() => {
    if (!handle || !visible || modalOpen) return;
    return registerTerminalFocus(sessionId, () => {
      void invoke("native_terminal_focus", { handle });
    });
  }, [handle, modalOpen, sessionId, visible]);
}

export function useNativeViewerFrameSync({
  handle,
  hostRef,
  activeRef,
  currentHandleRef,
  visible,
  modalOpen,
  onFailure,
}: {
  handle: string | null;
  hostRef: RefObject<HTMLDivElement | null>;
  activeRef: RefObject<boolean>;
  currentHandleRef: RefObject<string | null>;
  visible: boolean;
  modalOpen: boolean;
  onFailure: (error: unknown) => void;
}): void {
  const resizeFrameRef = useRef(0);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  useEffect(() => {
    const host = hostRef.current;
    if (!handle || !host || !visible || modalOpen) return;
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
  }, [activeRef, currentHandleRef, handle, hostRef, modalOpen, visible]);
}

export function useNativeViewerFocusSignal({
  sessionId,
  handle,
  focusSignal,
  visible,
  modalOpen,
}: {
  sessionId: string;
  handle: string | null;
  focusSignal?: number;
  visible: boolean;
  modalOpen: boolean;
}): void {
  const handledFocusSignalRef = useRef(0);

  useEffect(() => {
    if (!handle || !visible || modalOpen) return;
    const pendingSignal =
      focusSignal !== undefined &&
      focusSignal !== 0 &&
      focusSignal !== handledFocusSignalRef.current;
    if (!pendingSignal) return;
    handledFocusSignalRef.current = focusSignal;
    void invoke("native_terminal_focus", { handle });
  }, [focusSignal, handle, modalOpen, sessionId, visible]);
}
