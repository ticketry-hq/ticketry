import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

/**
 * The installation's private tmux server: socket `ticketry-e2e` under the
 * installation's own `TMUX_TMPDIR`, never the user's tmux.
 */
export const privateTmuxSocket = "ticketry-e2e";

export function resolveTmux({ environment = process.env } = {}) {
  return environment.TICKETRY_DESKTOP_ACCEPTANCE_TMUX
    ?? ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find(existsSync);
}

export function requireTmux(tmux = resolveTmux()) {
  if (!tmux) {
    throw new Error(
      "tmux is unavailable; install it or set TICKETRY_DESKTOP_ACCEPTANCE_TMUX",
    );
  }
  return tmux;
}

export function privateTmux(tmux, tmuxDirectory) {
  const runTmux = (args, options = {}) => spawnSync(tmux, ["-L", privateTmuxSocket, ...args], {
    env: { ...process.env, TMUX_TMPDIR: tmuxDirectory },
    encoding: "utf8",
    ...options,
  });

  function inventory() {
    const result = runTmux([
      "list-sessions",
      "-F",
      "#{session_name}|#{@pt-agent-run-id}|#{pane_dead}|#{pane_dead_status}|#{pane_current_command}|#{pane_start_command}",
    ]);
    return result.status === 0 ? result.stdout : "<no private tmux sessions>\n";
  }

  function capture() {
    const result = runTmux(["capture-pane", "-p", "-S", "-"]);
    return result.status === 0 ? result.stdout : "<no private tmux pane output>\n";
  }

  async function waitForEmpty(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (inventory().includes("<no private tmux sessions>")) {
        // The runtime settles its durable cleanup effect immediately after tmux
        // confirms absence. Let that same reconciliation pass commit first.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`private tmux did not become empty: ${inventory().trim()}`);
  }

  function killServer() {
    runTmux(["kill-server"], { stdio: "ignore" });
  }

  return { inventory, capture, waitForEmpty, killServer };
}
