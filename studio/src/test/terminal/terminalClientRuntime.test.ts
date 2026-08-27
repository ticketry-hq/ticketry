import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ desktop: false }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => runtime.desktop,
  Channel: class {},
  invoke: vi.fn(),
}));

describe("terminal client runtime selection", () => {
  beforeEach(() => {
    runtime.desktop = false;
    vi.resetModules();
  });

  it("attaches through the browser WebSocket outside the desktop", async () => {
    const [{ browserTerminalClient }, { terminalClientTransport }] = await Promise.all([
      import("../../features/agents/terminal/internal/browserTerminalClient"),
      import("../../features/agents/terminal/internal/terminalClientRuntime"),
    ]);

    // Browser development attaches to durable runs over the `/ws/terminal`
    // socket on the same origin as the GraphQL adapter.
    expect(terminalClientTransport).toBe(browserTerminalClient);
  });

  it("uses the Tauri viewer command adapter in the desktop", async () => {
    runtime.desktop = true;
    const [{ tauriTerminalClient }, { terminalClientTransport }] = await Promise.all([
      import("../../features/agents/terminal/internal/tauriTerminalClient"),
      import("../../features/agents/terminal/internal/terminalClientRuntime"),
    ]);

    expect(terminalClientTransport).toBe(tauriTerminalClient);
  });
});
