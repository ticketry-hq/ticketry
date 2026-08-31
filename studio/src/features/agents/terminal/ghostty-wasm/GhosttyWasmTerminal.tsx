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
  /** Whether this surface is the presented one; hidden surfaces stay detached. */
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    publishRendererMeasurements();
    // Only one viewer may hold a durable run; hand the pooled xterm viewer
    // over the same way the native renderer does.
    releasePooledTransport(sessionId);
    const surface = openGhosttyWasmSurface({
      agentRunId,
      host,
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
  }, [active, agentRunId, onUnavailable, sessionId]);

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
      className="relative h-full w-full overflow-hidden bg-pane-bg"
      onMouseDown={() => surfaceRef.current?.focus()}
    />
  );
}
