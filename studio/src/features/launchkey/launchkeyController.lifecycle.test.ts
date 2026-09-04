import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLaunchkeyController } from "./launchkeyController";
import {
  DeferredDisconnectMidiRuntime,
  DeferredDiscoveryMidiRuntime,
  DISCOVERY_INTERVAL_MS,
  LAUNCHKEY_MINI_MK3_PORTS,
  MemoryMidiRuntime,
  NO_PORTS,
} from "./launchkeyController.testFixtures";

describe("Launchkey controller lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the newest start connected when an older stop overlaps discovery", async () => {
    const midi = new DeferredDiscoveryMidiRuntime();
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    const firstStart = controller.start();
    const olderStop = controller.stop();
    const newestStart = controller.start();
    midi.finishDiscovery(LAUNCHKEY_MINI_MK3_PORTS);

    await Promise.all([firstStart, olderStop, newestStart]);
    const connection = midi.connectedTransports[0];

    expect(midi.connectedTransports).toHaveLength(1);
    expect(connection?.connected).toBe(true);
    expect(connection?.disconnectCalls).toBe(0);

    await controller.stop();
  });

  it("waits for a state-event disconnect to finish before stop settles", async () => {
    const midi = new DeferredDisconnectMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();
    midi.transport.loseConnection();
    expect(midi.transport.disconnectCalls).toBe(1);

    let stopOutcome: "pending" | "resolved" | "rejected" = "pending";
    const stop = controller.stop().then(
      () => {
        stopOutcome = "resolved";
      },
      (error: unknown) => {
        stopOutcome = "rejected";
        throw error;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    const outcomeBeforeNativeDisconnect = stopOutcome;

    midi.transport.finishDisconnect();
    await stop;

    expect(outcomeBeforeNativeDisconnect).toBe("pending");
    expect(stopOutcome).toBe("resolved");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("selects only the matched Mini MK3 MIDI and DAW port ids", async () => {
    const midi = new MemoryMidiRuntime();
    midi.availablePorts = {
      inputs: [
        { id: "other-in", name: "Other MIDI Keyboard" },
        { id: "mini-midi-in", name: "Launchkey Mini MK3" },
        { id: "mini-daw-in", name: "MIDIIN2 (Launchkey Mini MK3)" },
      ],
      outputs: [
        { id: "other-out", name: "Other MIDI Keyboard" },
        { id: "mini-midi-out", name: "Launchkey Mini MK3" },
        { id: "mini-daw-out", name: "MIDIOUT2 (Launchkey Mini MK3)" },
      ],
    };
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();

    expect(midi.connectSelections).toEqual([{
      midiInput: "mini-midi-in",
      dawInput: "mini-daw-in",
      midiOutput: "mini-midi-out",
      dawOutput: "mini-daw-out",
    }]);

    await controller.stop();
  });

  it("discovers, reconnects, and shuts down a hot-plugged Launchkey without leaking timers", async () => {
    const midi = new MemoryMidiRuntime();
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();

    expect(midi.listPortsCalls).toBe(1);
    expect(midi.connectedTransports).toEqual([]);

    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);

    const firstConnection = midi.connectedTransports[0];
    expect(firstConnection?.sent.slice(0, 2)).toEqual([
      { port: "daw", data: [0x9f, 0x0c, 0x7f] },
      { port: "daw", data: [0xbf, 0x03, 0x02] },
    ]);

    midi.availablePorts = NO_PORTS;
    firstConnection?.loseConnection();
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(midi.connectedTransports).toHaveLength(1);

    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(midi.connectedTransports).toHaveLength(2);
    expect(midi.connectedTransports[1]?.sent.slice(0, 2)).toEqual([
      { port: "daw", data: [0x9f, 0x0c, 0x7f] },
      { port: "daw", data: [0xbf, 0x03, 0x02] },
    ]);

    await controller.stop();

    expect(midi.connectedTransports[1]?.sent.at(-1)).toEqual({
      port: "daw",
      data: [0x9f, 0x0c, 0],
    });
    expect(midi.connectedTransports[1]?.disconnectCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers when transport connectivity drops without a state callback", async () => {
    const midi = new MemoryMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();
    expect(midi.connectedTransports).toHaveLength(1);

    midi.availablePorts = NO_PORTS;
    midi.connectedTransports[0]?.loseConnectionSilently();
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(midi.connectedTransports).toHaveLength(1);

    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(midi.connectedTransports).toHaveLength(2);

    await controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnects a device missing from discovery and reconnects when its ports return", async () => {
    const midi = new MemoryMidiRuntime();
    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    const controller = createLaunchkeyController({
      midi,
      discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    });

    await controller.start();
    const firstConnection = midi.connectedTransports[0];
    expect(firstConnection?.connected).toBe(true);

    midi.availablePorts = NO_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);

    expect(firstConnection?.disconnectCalls).toBe(1);
    expect(firstConnection?.sent.at(-1)).toEqual({
      port: "daw",
      data: [0x9f, 0x0c, 0],
    });

    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    expect(midi.connectedTransports).toHaveLength(2);

    await controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
