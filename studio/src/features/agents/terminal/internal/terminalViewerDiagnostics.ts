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
