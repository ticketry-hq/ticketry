import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  foregroundKey,
  useTerminalForegroundStore,
  type ForegroundOwner,
} from "./internal/foregroundStore";
import {
  registerPoolDriver,
  releasePooledTransport,
  syncEntries,
} from "./internal/entryPool";
import { useTerminalStore } from "./internal/sessionStore";
import { useTerminalOwnership } from "./internal/useTerminalOwnership";
import { useWorkspaceTabsStore } from "./internal/workspaceTabsStore";

type NativeTerminalStatus = {
  handle: string;
  runId: string;
  columns: number;
  rows: number;
};

type NativeTerminalFailure = {
  handle: string;
  runId: string;
  reason?: string;
};

let availability: Promise<boolean> | null = null;

export function nativeGhosttyAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  availability ??= invoke<boolean>("native_terminal_available").catch(() => false);
  return availability;
}

export function NativeGhosttyTerminal({
  sessionId,
  owner,
  focusSignal,
  manageForegroundHost = true,
  onReady,
  onUnavailable,
}: {
  sessionId: string;
  owner: ForegroundOwner;
  focusSignal?: number;
  manageForegroundHost?: boolean;
  onReady?: () => void;
  onUnavailable?: (reason: string) => void;
}) {
  const sessions = useTerminalStore((state) => state.sessions);
  const registerHost = useTerminalForegroundStore((state) => state.registerHost);
  const unregisterHost = useTerminalForegroundStore((state) => state.unregisterHost);
  const focusRequest = useWorkspaceTabsStore((state) => state.focusRequest);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<string | null>(null);
  const [nativeHandle, setNativeHandle] = useState<string | null>(null);
  const focusOnAttachRef = useRef(focusSignal === undefined);
  const resizeFrameRef = useRef(0);
  const handledFocusSignalRef = useRef(0);
  const handledFocusRequestRef = useRef(0);

  useEffect(() => syncEntries(sessions), [sessions]);
  const session = sessions[sessionId] ?? null;
  const runId = session?.agentRunId ?? null;
  const key = session ? foregroundKey(session) : null;
  const { acquire, resolvedOwner } = useTerminalOwnership(key, owner);
  const visible = !!runId && resolvedOwner === owner;

  useEffect(() => {
    if (manageForegroundHost) registerHost(owner, hostRef.current);
    const releaseDriver = manageForegroundHost ? registerPoolDriver() : null;
    return () => {
      if (manageForegroundHost) unregisterHost(owner);
      releaseDriver?.();
    };
  }, [
    manageForegroundHost,
    owner,
    registerHost,
    unregisterHost,
  ]);

  useEffect(() => {
    if (!visible || !runId) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let unlisten: UnlistenFn | null = null;

    const scheduleFrame = () => {
      if (resizeFrameRef.current) return;
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = 0;
        const host = hostRef.current;
        const handle = handleRef.current;
        if (!host || !handle) return;
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        if (right <= x || bottom <= y) return;
        void invoke<NativeTerminalStatus>("native_terminal_set_frame", {
          handle,
          frame: {
            x,
            y,
            width: right - x,
            height: bottom - y,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
        });
      });
    };

    const attach = async () => {
      try {
        unlisten = await listen<NativeTerminalFailure>(
          "native-terminal-failed",
          (event) => {
            if (event.payload.runId === runId) {
              onUnavailable?.(
                event.payload.reason ?? "the native terminal bridge disconnected",
              );
            }
          },
        );
        if (disposed) {
          unlisten();
          unlisten = null;
          return;
        }

        const status = await invoke<NativeTerminalStatus>(
          "native_terminal_attach",
          { runId },
        );
        if (disposed) {
          void invoke("native_terminal_detach", { handle: status.handle });
          return;
        }
        handleRef.current = status.handle;
        const host = hostRef.current;
        if (!host) throw new Error("native terminal host was not mounted");
        const rect = host.getBoundingClientRect();
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        if (right <= x || bottom <= y) {
          throw new Error("native terminal host has no visible frame");
        }
        const framed = await invoke<NativeTerminalStatus>(
          "native_terminal_set_frame",
          {
            handle: status.handle,
            frame: {
              x,
              y,
              width: right - x,
              height: bottom - y,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            },
          },
        );
        if (framed.columns <= 0 || framed.rows <= 0) {
          throw new Error("native terminal renderer returned an empty grid");
        }
        if (disposed) {
          handleRef.current = null;
          void invoke("native_terminal_detach", { handle: status.handle });
          return;
        }
        // Keep xterm's transport alive until the native surface and its bridge
        // have both attached and accepted a visible frame.
        releasePooledTransport(sessionId);
        setNativeHandle(status.handle);
        onReady?.();
        observer = new ResizeObserver(scheduleFrame);
        if (hostRef.current) observer.observe(hostRef.current);
        window.addEventListener("resize", scheduleFrame);
        window.addEventListener("scroll", scheduleFrame, true);
        scheduleFrame();
        if (focusOnAttachRef.current) {
          void invoke("native_terminal_focus", { handle: status.handle });
        }
      } catch (error) {
        console.error("native libghostty attach failed", error);
        const handle = handleRef.current;
        handleRef.current = null;
        if (handle) void invoke("native_terminal_detach", { handle });
        if (!disposed) onUnavailable?.(nativeFailureMessage(error));
      }
    };
    void attach();

    return () => {
      disposed = true;
      unlisten?.();
      observer?.disconnect();
      window.removeEventListener("resize", scheduleFrame);
      window.removeEventListener("scroll", scheduleFrame, true);
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = 0;
      const handle = handleRef.current;
      handleRef.current = null;
      setNativeHandle(null);
      if (handle) void invoke("native_terminal_detach", { handle });
    };
  }, [onReady, onUnavailable, runId, sessionId, visible]);

  useEffect(() => {
    const handle = nativeHandle;
    if (!handle || !visible) return;
    const pendingSignal =
      focusSignal !== undefined &&
      focusSignal !== 0 &&
      focusSignal !== handledFocusSignalRef.current;
    const pendingRequest =
      focusRequest !== null &&
      focusRequest.sessionId === sessionId &&
      focusRequest.sequence !== handledFocusRequestRef.current;
    if (!pendingSignal && !pendingRequest) return;
    if (pendingSignal && focusSignal !== undefined) {
      handledFocusSignalRef.current = focusSignal;
    }
    if (pendingRequest && focusRequest) {
      handledFocusRequestRef.current = focusRequest.sequence;
    }
    void invoke("native_terminal_focus", { handle });
  }, [focusRequest, focusSignal, nativeHandle, sessionId, visible]);

  const presentedElsewhere = session !== null && resolvedOwner !== owner;
  return (
    <div className="relative h-full w-full bg-pane-bg">
      <div
        ref={hostRef}
        className="absolute inset-2 bg-black"
        data-testid="native-terminal-host"
        data-terminal-renderer="libghostty"
      />
      {presentedElsewhere && resolvedOwner ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-pane-bg p-4 text-center text-sm text-text-muted">
          <p>This terminal is open in {resolvedOwner === "studio" ? "the fallback workspace" : "the issue drawer"}.</p>
          <button
            type="button"
            onClick={() => key && acquire(key, owner)}
            className="rounded-md border border-pane-border px-3 py-1 text-sm text-text-primary hover:bg-pane-title"
          >
            View here
          </button>
        </div>
      ) : null}
    </div>
  );
}

function nativeFailureMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "native terminal attachment failed";
}
