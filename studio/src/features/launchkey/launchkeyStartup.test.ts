import { describe, expect, it, vi } from "vitest";

import type { StudioRuntime } from "../../runtime";
import type { LaunchkeyController } from "./launchkeyController";
import { createLaunchkeyStartup } from "./launchkeyStartup";

describe("Launchkey startup", () => {
  it("creates and starts one controller for the desktop application", () => {
    const midi = { listPorts: vi.fn(), connect: vi.fn() };
    const runtime = {
      platform: "desktop",
      launchkey: { midi: vi.fn(() => midi) },
    } as unknown as StudioRuntime;
    const controller: LaunchkeyController = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const createController = vi.fn(() => controller);
    const startup = createLaunchkeyStartup({ createController });

    startup.start(runtime);
    startup.start(runtime);

    expect(runtime.launchkey.midi).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenCalledOnce();
    expect(createController).toHaveBeenCalledWith({ midi });
    expect(controller.start).toHaveBeenCalledOnce();
  });

  it("does not ask browser startup for a MIDI runtime", () => {
    const runtime = {
      platform: "browser",
      launchkey: { midi: vi.fn() },
    } as unknown as StudioRuntime;
    const createController = vi.fn();
    const startup = createLaunchkeyStartup({ createController });

    startup.start(runtime);

    expect(runtime.launchkey.midi).not.toHaveBeenCalled();
    expect(createController).not.toHaveBeenCalled();
  });
});
