import { describe, expect, it, vi } from "vitest";

import { installDesktopFileLogging } from "./desktopFileLogging";
import type { DesktopFileLoggingInvoke } from "./desktopFileLogging";

function options(enabled: boolean) {
  const invoke = vi.fn(async (command: string) =>
    command === "desktop_file_logging_enabled" ? enabled : undefined
  ) as unknown as DesktopFileLoggingInvoke;
  const targetConsole = {
    debug: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Console;
  const targetWindow = new EventTarget() as Window;
  return { invoke, targetConsole, targetWindow };
}

describe("desktop file logging", () => {
  it("leaves production console methods untouched when the flag is off", async () => {
    const setup = options(false);
    const originalInfo = setup.targetConsole.info;

    await installDesktopFileLogging(setup);
    setup.targetConsole.info("not persisted");

    expect(setup.targetConsole.info).toBe(originalInfo);
    expect(setup.invoke).toHaveBeenCalledOnce();
  });

  it("mirrors frontend records when the process flag is on", async () => {
    const setup = options(true);
    const uninstall = await installDesktopFileLogging(setup);

    setup.targetConsole.info("story move", { id: "story-1" });
    await vi.waitFor(() => expect(setup.invoke).toHaveBeenLastCalledWith(
      "desktop_append_frontend_log",
      { level: "info", message: 'story move {"id":"story-1"}' },
    ));

    uninstall();
  });
});

