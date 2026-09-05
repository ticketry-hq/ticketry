import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_RUN_ACTIONS } from "../../app/navigation/actionIds";
import {
  agentRun,
  agentStatusHolding,
  DISCOVERY_INTERVAL_MS,
  LAUNCHKEY_MINI_MK3_PORTS,
  NO_PORTS,
  settleInput,
  startConnectedController,
} from "./launchkeyController.testFixtures";

describe("Launchkey controller input routing", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("focuses the run assigned to a pressed lit pad and ignores empty pads", async () => {
    const { controller, dispatchAction, transport } =
      await startConnectedController([agentRun()]);

    transport.receive("daw", [0x90, 97, 127]);
    transport.receive("daw", [0x90, 96, 127]);
    await settleInput();

    expect(dispatchAction).toHaveBeenCalledOnce();
    expect(dispatchAction).toHaveBeenCalledWith(
      AGENT_RUN_ACTIONS.focusAgentRun,
      { runId: "run-1" },
    );

    await controller.stop();
  });

  it("focuses and frees error and lost pads when they are pressed", async () => {
    const failed = agentRun({ agent_run_id: "error-run", state: "error" });
    const lost = agentRun({
      agent_run_id: "lost-run",
      state: "lost",
      started_at: "2026-09-04T08:00:01.000Z",
    });
    const { controller, dispatchAction, status, transport } =
      await startConnectedController([failed, lost]);

    transport.receive("daw", [0x90, 96, 127]);
    transport.receive("daw", [0x90, 97, 127]);
    await settleInput();

    expect(dispatchAction.mock.calls).toEqual([
      [AGENT_RUN_ACTIONS.focusAgentRun, { runId: "error-run" }],
      [AGENT_RUN_ACTIONS.focusAgentRun, { runId: "lost-run" }],
    ]);
    expect(transport.sent).toEqual([
      { port: "daw", data: [0x90, 96, 0] },
      { port: "daw", data: [0x91, 96, 0] },
      { port: "daw", data: [0x92, 96, 0] },
      { port: "daw", data: [0x90, 97, 0] },
      { port: "daw", data: [0x91, 97, 0] },
      { port: "daw", data: [0x92, 97, 0] },
    ]);

    transport.sent.length = 0;
    status.publish(agentStatusHolding([
      failed,
      lost,
      agentRun({
        agent_run_id: "replacement-1",
        started_at: "2026-09-04T08:00:02.000Z",
      }),
      agentRun({
        agent_run_id: "replacement-2",
        started_at: "2026-09-04T08:00:03.000Z",
      }),
    ]));

    expect(transport.sent).toContainEqual({
      port: "daw",
      data: [0x90, 96, 21],
    });
    expect(transport.sent).toContainEqual({
      port: "daw",
      data: [0x90, 97, 21],
    });

    await controller.stop();
  });

  it("routes record and play presses and alternates the record LED", async () => {
    const { controller, dispatchAction, transport } =
      await startConnectedController();

    transport.receive("daw", [0xbf, 117, 127]);
    transport.receive("daw", [0xbf, 117, 127]);
    transport.receive("daw", [0xbf, 115, 127]);
    await settleInput();

    expect(dispatchAction.mock.calls).toEqual([
      [AGENT_RUN_ACTIONS.toggleVoiceTranscription],
      [AGENT_RUN_ACTIONS.toggleVoiceTranscription],
      [AGENT_RUN_ACTIONS.submitSelectedRunTerminal],
    ]);
    expect(transport.sent).toEqual([
      { port: "daw", data: [0xbf, 117, 127] },
      { port: "daw", data: [0xbf, 117, 0] },
    ]);

    await controller.stop();
  });

  it("restores the lit record LED after reconnect without toggling voice again", async () => {
    const { controller, dispatchAction, midi, transport } =
      await startConnectedController();

    transport.receive("daw", [0xbf, 117, 127]);
    await settleInput();
    midi.availablePorts = NO_PORTS;
    transport.loseConnection();
    await settleInput();

    midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
    await vi.advanceTimersByTimeAsync(DISCOVERY_INTERVAL_MS);
    const reconnected = midi.connectedTransports[1];

    expect(reconnected?.sent).toContainEqual({
      port: "daw",
      data: [0xbf, 117, 127],
    });
    expect(dispatchAction).toHaveBeenCalledOnce();
    expect(dispatchAction).toHaveBeenCalledWith(
      AGENT_RUN_ACTIONS.toggleVoiceTranscription,
    );

    await controller.stop();
  });

  it("ignores releases, musical controls, and unsupported transport controls", async () => {
    const { controller, dispatchAction, transport } =
      await startConnectedController([agentRun()]);

    transport.receive("daw", [0x80, 96, 0]);
    transport.receive("midi", [0x90, 60, 100]);
    transport.receive("daw", [0xbf, 21, 64]);
    transport.receive("midi", [0xe0, 0, 64]);
    transport.receive("midi", [0xb0, 1, 64]);
    transport.receive("midi", [0xb0, 64, 127]);
    transport.receive("daw", [0xbf, 74, 127]);
    transport.receive("daw", [0xbf, 115, 0]);
    transport.receive("daw", [0xbf, 117, 0]);
    await settleInput();

    expect(dispatchAction).not.toHaveBeenCalled();
    expect(transport.sent).toEqual([]);

    await controller.stop();
  });
});
