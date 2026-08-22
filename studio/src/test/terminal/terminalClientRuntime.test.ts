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

  it("keeps the backend WebSocket adapter for browser development", async () => {
    const [{ browserTerminalClient }, { terminalClientTransport }] = await Promise.all([
      import("../../features/agents/terminal/internal/browserTerminalClient"),
      import("../../features/agents/terminal/internal/terminalClientRuntime"),
    ]);

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
