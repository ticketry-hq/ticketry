import type { MidiTransport } from "@bandwati/launchkey-adaptor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LaunchkeyMidiSelection } from "../../runtime";
import { createLaunchkeyController } from "./launchkeyController";
import {
  DISCOVERY_INTERVAL_MS,
  LAUNCHKEY_MINI_MK3_PORTS,
  MemoryMidiRuntime,
} from "./launchkeyController.testFixtures";

class OnceRejectingMidiRuntime extends MemoryMidiRuntime {
  connectAttempts = 0;

  override async connect(options?: {
    readonly ports?: LaunchkeyMidiSelection;
  }): Promise<MidiTransport> {
    this.connectAttempts += 1;
    if (this.connectAttempts === 1) {
      throw new Error("temporary MIDI connection failure");
    }
    return super.connect(options);
  }
}

describe("Launchkey controller discovery resilience", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("silently retries discovery after a transient connection failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const midi = new OnceRejectingMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();

    expect(midi.connectAttempts).toBe(1);
    expect(midi.connectedTransports).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);

    expect(midi.connectAttempts).toBe(2);
    expect(midi.connectedTransports).toHaveLength(1);

    await controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
