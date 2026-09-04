/**
 * What the surface should do when its viewer transport stops.
 *
 * The surface holds one `TerminalClient` for the life of the run and never
 * released it on a transport failure, so a viewer that died stayed installed
 * and every later attach was a no-op — a terminal that looked attached and
 * accepted no input. The decision of whether a dead viewer can be replaced is
 * policy, not plumbing, so it lives here where it can be read and tested
 * without a wasm runtime.
 */
import type { TerminalClientEvent } from "../../internal/terminalClient";

/**
 * - `ignore`   — not a viewer-ending event.
 * - `drop`     — release the client; a later activation or keystroke may reattach.
 * - `reattach` — release the client and attach a new viewer now.
 * - `retire`   — the durable run is gone; never attach again.
 */
export type ViewerRecoveryAction = "ignore" | "drop" | "reattach" | "retire";

export interface ViewerRecoveryContext {
  /** Whether the surface is currently the presented terminal. */
  readonly active: boolean;
}

export interface ViewerRecovery {
  plan(event: TerminalClientEvent, context: ViewerRecoveryContext): ViewerRecoveryAction;
}

/** Reattachment reasons that mean the durable tmux session no longer exists. */
const RUN_IS_GONE = new Set([
  "session_ended",
  "session_not_found",
  "invalid_run_id",
]);

export function createViewerRecovery(): ViewerRecovery {
  // One immediate reattach per healthy viewer. Without a budget an attach that
  // fails the same way each time becomes a reconnect loop against tmux.
  let immediateReattachBudget = 1;

  return {
    plan(event, context) {
      if (event.type === "ready") {
        immediateReattachBudget = 1;
        return "ignore";
      }
      if (event.type === "reattachment_required") {
        if (RUN_IS_GONE.has(event.reason)) return "retire";
        // Losing the lease means another window took the run. Reattaching
        // immediately would make the two windows fight over it, so step aside
        // and let the reader's next activation or keystroke claim it back.
        if (event.reason === "replaced_by_another_viewer") return "drop";
        return reattachIfActive(context);
      }
      if (event.type !== "closed") return "ignore";
      switch (event.reason) {
        case "client_detach":
          return "ignore";
        case "pty_eof":
        case "viewer_exit":
          return "retire";
        default:
          return reattachIfActive(context);
      }
    },
  };

  function reattachIfActive(context: ViewerRecoveryContext): ViewerRecoveryAction {
    if (!context.active) return "drop";
    if (immediateReattachBudget <= 0) return "drop";
    immediateReattachBudget -= 1;
    return "reattach";
  }
}
