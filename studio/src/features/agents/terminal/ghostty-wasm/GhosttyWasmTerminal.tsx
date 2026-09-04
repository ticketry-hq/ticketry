/**
 * CODING-1304 — the WebView-hosted Ghostty renderer, behind the experiment gate.
 *
 * Deliberately thin: it owns a host element and the surface's lifetime, and
 * nothing else. Frames never pass through React, so a busy terminal does not
 * re-render the Studio tree.
 */
import { useEffect, useRef } from "react";

import { releasePooledTransport } from "../internal/entryPool";
import { terminalClientTransport } from "../internal/terminalClientRuntime";
import { registerTerminalFocus } from "../internal/terminalRegistry";
import {
  openGhosttyWasmSurface,
  type GhosttyWasmFailureReason,
  type GhosttyWasmSurface,
} from "./internal/surface";
import { publishRendererMeasurements } from "./internal/rendererMeasurement";

export interface GhosttyWasmTerminalProps {
  sessionId: string;
  agentRunId: string;
  /** Whether this surface is presented; hidden surfaces retain live terminal state. */
  active?: boolean;
  focusSignal?: number;
  onUnavailable: (reason: string) => void;
}

export function GhosttyWasmTerminal({
  sessionId,
  agentRunId,
  active = true,
  focusSignal,
  onUnavailable,
}: GhosttyWasmTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<GhosttyWasmSurface | null>(null);
  const handledFocusSignalRef = useRef(0);
  // Read by the surface effect, which re-runs whenever the run or session
  // changes. Retained viewers mount inactive and are activated later by prop,
  // so a surface opened with the mount-time value would never attach its
  // client and would silently drop every keystroke.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    publishRendererMeasurements();
    // Only one viewer may hold a durable run; hand the pooled xterm viewer
    // over the same way the native renderer does.
    releasePooledTransport(sessionId);
    const surface = openGhosttyWasmSurface({
      agentRunId,
      host,
      active: activeRef.current,
      transport: terminalClientTransport,
      onFailure: (reason: GhosttyWasmFailureReason, detail) => {
        onUnavailable(`${reason}: ${detail}`);
      },
    });
    surfaceRef.current = surface;
    return () => {
      surfaceRef.current = null;
      surface.detach();
    };
    // `active` deliberately does not own this lifetime. Retained story
    // viewers keep their Ghostty state, Canvas and viewer attachment while
    // hidden. The effect below only turns painting on and off.
  }, [agentRunId, onUnavailable, sessionId]);

  useEffect(() => {
    surfaceRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    return registerTerminalFocus(sessionId, () => surfaceRef.current?.focus());
  }, [active, sessionId]);

  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return;
    if (focusSignal === handledFocusSignalRef.current) return;
    handledFocusSignalRef.current = focusSignal;
    surfaceRef.current?.focus();
  }, [focusSignal]);

  return (
    <div
      ref={hostRef}
      data-testid="ghostty-wasm-host"
      className="relative h-full w-full overflow-hidden bg-inherit"
      onMouseDown={(event) => {
        // Without this the browser's default mousedown action moves focus to
        // the nearest focusable ancestor (the workspace tab body), undoing the
        // focus below: the terminal then looks focused but ignores keys. It
        // also suppresses DOM text selection over the canvas, which is
        // correct — selection belongs to Ghostty.
        event.preventDefault();
        surfaceRef.current?.focus();
      }}
    />
  );
}
