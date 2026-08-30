import { describe, expect, it, vi } from "vitest";

import { installWebFileLogging } from "./webFileLogging";

function targets() {
  const targetConsole = {
    debug: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Console;
  const targetWindow = new EventTarget() as Window;
  return { targetConsole, targetWindow };
}

describe("web file logging", () => {
  it("leaves browser console methods untouched when the flag is off", async () => {
    const setup = targets();
    const originalInfo = setup.targetConsole.info;
    const targetFetch = vi.fn();

    await installWebFileLogging({ ...setup, enabled: false, targetFetch });
    setup.targetConsole.info("not persisted");

    expect(setup.targetConsole.info).toBe(originalInfo);
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it("posts structured console records to the local Vite logger", async () => {
    const setup = targets();
    const targetFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const uninstall = await installWebFileLogging({
      ...setup,
      enabled: true,
      targetFetch,
    });

    setup.targetConsole.error("story move failed", { code: "conflict" });
    await vi.waitFor(() => expect(targetFetch).toHaveBeenCalledWith(
      "/__ticketry/frontend-log",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          level: "error",
          message: 'story move failed {"code":"conflict"}',
        }),
      }),
    ));

    uninstall();
  });
});

