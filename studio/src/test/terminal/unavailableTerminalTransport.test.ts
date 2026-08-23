import { describe, expect, it, vi } from "vitest";

import {
  TERMINAL_TRANSPORT_UNAVAILABLE,
  unavailableTerminalTransport,
} from "../../features/agents/terminal/internal/unavailableTerminalTransport";
import type { TerminalClientEvent } from "../../features/agents/terminal/internal/terminalClient";

describe("terminal transport on a platform without a byte stream", () => {
  it("reports the missing capability and closes without opening a socket", async () => {
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", socket);
    const events: TerminalClientEvent[] = [];

    const client = unavailableTerminalTransport.attach(
      { agentRunId: "run-1", cols: 80, rows: 24 },
      (event) => events.push(event),
    );
    await Promise.resolve();

    expect(socket).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "error",
        layer: "transport",
        message: TERMINAL_TRANSPORT_UNAVAILABLE,
      },
      {
        type: "closed",
        reason: "transport_closed",
        code: 1000,
        detail: TERMINAL_TRANSPORT_UNAVAILABLE,
      },
    ]);
    expect(client.status()).toBe("closed");
    expect(client.suspend()).toBe(false);
    vi.unstubAllGlobals();
  });
});
