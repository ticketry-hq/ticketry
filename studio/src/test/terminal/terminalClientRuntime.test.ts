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

  it("reports the missing byte stream outside the desktop", async () => {
    const [{ unavailableTerminalTransport }, { terminalClientTransport }] = await Promise.all([
      import("../../features/agents/terminal/internal/unavailableTerminalTransport"),
      import("../../features/agents/terminal/internal/terminalClientRuntime"),
    ]);

    // The `/ws/terminal` socket browser development used to open was retired
    // with the Python terminal authority, so there is no second byte stream to
    // fall back to — only an honest refusal.
    expect(terminalClientTransport).toBe(unavailableTerminalTransport);
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
