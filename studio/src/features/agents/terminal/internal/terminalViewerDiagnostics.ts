import type { TerminalClientEvent } from "./terminalClient";
import type { SessionStatus } from "./sessionStore";

interface ViewerEventContext {
  sessionId: string;
  agentRunId: string | null;
  currentStatus: SessionStatus | null;
  event: TerminalClientEvent;
}

interface PoolDisposalContext {
  sessionId: string;
  agentRunId: string | null;
  reason: "store_session_removed" | "native_viewer_takeover";
}

/**
 * Persist lifecycle-only viewer facts through the development console bridge.
 * Terminal output is deliberately excluded so diagnostics cannot capture the
 * user's conversation or command output.
 */
export function recordTerminalViewerEvent(context: ViewerEventContext): void {
  if (context.event.type === "output") return;
  const details = {
    sessionId: context.sessionId,
    agentRunId: context.agentRunId,
    currentStatus: context.currentStatus,
    event: context.event,
  };
  if (
    context.event.type === "error" ||
    context.event.type === "closed" ||
    context.event.type === "reattachment_required"
  ) {
    console.warn("[terminal-viewer] lifecycle event", details);
    return;
  }
  console.info("[terminal-viewer] lifecycle event", details);
}

export function recordTerminalPoolDisposal(context: PoolDisposalContext): void {
  console.info("[terminal-viewer] pooled entry released", context);
}

interface NativeRendererFallbackContext {
  runId: string;
  sessionId: string | null;
  /** The code path that observed the failure, e.g. `attach`, `frame-sync`. */
  origin: string;
  reason: string;
  handle: string | null;
  error?: unknown;
}

/**
 * Record a native renderer failure for operators. The failure is local to its
 * terminal: xterm takes over the same run and tmux session, so this log line is
 * the only trace the desktop file log keeps of why a terminal is not native.
 * A failing console bridge must never keep the fallback from rendering.
 */
export function recordNativeRendererFallback(
  context: NativeRendererFallbackContext,
): void {
  try {
    console.warn("[terminal-viewer] native renderer failed; xterm takes over", {
      ...context,
      error: context.error instanceof Error
        ? { name: context.error.name, message: context.error.message, stack: context.error.stack }
        : context.error ?? null,
    });
  } catch {
    // Diagnostics are best effort.
  }
}
