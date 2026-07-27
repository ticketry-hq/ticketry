import { describe, expect, it } from "vitest";

import { browserTerminalClient } from "../../features/agents/terminal/internal/browserTerminalClient";
import { terminalClientTransport } from "../../features/agents/terminal/internal/terminalClientRuntime";

describe("terminal client runtime selection", () => {
  it("uses the tmux WebSocket adapter in the browser and Tauri", () => {
    expect(terminalClientTransport).toBe(browserTerminalClient);
  });
});
