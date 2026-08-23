import type {
  TerminalClient,
  TerminalClientAttachParams,
  TerminalClientEvent,
  TerminalClientStatus,
  TerminalClientTransport,
} from "./terminalClient";

/**
 * The transport a platform without a terminal byte stream gets.
 *
 * Terminal bytes are owned by the Rust tmux adapter and reach Studio over
 * Tauri. Browser development has no such channel — the `/ws/terminal` socket it
 * used to fall back to was retired with the Python terminal authority — so an
 * attach here reports the missing capability once and closes. It never opens a
 * socket, so a browser tab cannot sit reconnecting against a route that no
 * longer exists.
 */
export const TERMINAL_TRANSPORT_UNAVAILABLE = "terminal_requires_desktop";

export const unavailableTerminalTransport: TerminalClientTransport = {
  attach(_params: TerminalClientAttachParams, onEvent: (event: TerminalClientEvent) => void): TerminalClient {
    let state: TerminalClientStatus = "closed";
    queueMicrotask(() => {
      onEvent({
        type: "error",
        layer: "transport",
        message: TERMINAL_TRANSPORT_UNAVAILABLE,
      });
      onEvent({
        type: "closed",
        reason: "transport_closed",
        code: 1000,
        detail: TERMINAL_TRANSPORT_UNAVAILABLE,
      });
    });
    return {
      input() {},
      resize() {},
      scroll() {},
      detach() {
        state = "closed";
      },
      suspend() {
        return false;
      },
      resume() {},
      status() {
        return state;
      },
    };
  },
};
