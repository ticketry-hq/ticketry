import {
  LaunchkeyMiniMK3,
  type ButtonEvent,
  type PadEvent,
} from "@bandwati/launchkey-adaptor";

import {
  AGENT_RUN_ACTIONS,
  type AgentRunActionId,
} from "../../app/navigation/actionIds";
import { studioKeymapRegistry } from "../../app/navigation/keymapRegistry";
import type {
  LaunchkeyMidiPorts,
  LaunchkeyMidiRuntime,
  LaunchkeyMidiSelection,
} from "../../runtime";
import {
  readAgentStatusHolding,
  subscribeAgentStatusHolding,
  type AgentStatusData,
} from "../agents/status";
import { createRunPadProjection } from "./runPadProjection";

const DEFAULT_DISCOVERY_INTERVAL_MS = 2_000;
const LAUNCHKEY_MINI_MK3 = /launchkey mini mk3/i;
const DAW_PORT = /daw|midi(in|out)2/i;

function selectPort(
  ports: LaunchkeyMidiPorts["inputs"] | LaunchkeyMidiPorts["outputs"],
  daw: boolean,
) {
  return ports.find((port) =>
    LAUNCHKEY_MINI_MK3.test(port.name ?? "") &&
    DAW_PORT.test(port.name ?? "") === daw
  );
}

function selectLaunchkeyMiniMK3(
  ports: LaunchkeyMidiPorts,
): LaunchkeyMidiSelection | null {
  const midiInput = selectPort(ports.inputs, false);
  const dawInput = selectPort(ports.inputs, true);
  const midiOutput = selectPort(ports.outputs, false);
  const dawOutput = selectPort(ports.outputs, true);
  if (!dawInput || !dawOutput) return null;
  return {
    midiInput: midiInput?.id,
    dawInput: dawInput.id,
    midiOutput: midiOutput?.id,
    dawOutput: dawOutput.id,
  };
}

function includesPort(
  available: LaunchkeyMidiPorts["inputs"] | LaunchkeyMidiPorts["outputs"],
  connected: { readonly id?: string; readonly name?: string } | null | undefined,
): boolean {
  if (!connected) return false;
  return available.some((candidate) => connected.id
    ? candidate.id === connected.id
    : candidate.name === connected.name);
}

function stillPresent(
  connected: LaunchkeyMiniMK3,
  available: LaunchkeyMidiPorts,
): boolean {
  return includesPort(available.inputs, connected.ports?.dawInput) &&
    includesPort(available.outputs, connected.ports?.dawOutput);
}

export interface LaunchkeyController {
  start(): Promise<void>;
  stop(): Promise<void>;
}

type ActionDispatcher = (
  actionId: AgentRunActionId,
  payload?: unknown,
) => Promise<boolean>;

interface LaunchkeyControllerOptions {
  readonly midi: LaunchkeyMidiRuntime;
  readonly discoveryIntervalMs?: number;
  readonly readStatus?: () => AgentStatusData;
  readonly subscribeStatus?: (listener: () => void) => () => void;
  readonly dispatchAction?: ActionDispatcher;
}

export function createLaunchkeyController({
  midi,
  discoveryIntervalMs = DEFAULT_DISCOVERY_INTERVAL_MS,
  readStatus = readAgentStatusHolding,
  subscribeStatus = subscribeAgentStatusHolding,
  dispatchAction = (actionId, payload) =>
    studioKeymapRegistry.dispatch(actionId, payload),
}: LaunchkeyControllerOptions): LaunchkeyController {
  let active = false;
  let device: LaunchkeyMiniMK3 | null = null;
  let deviceSubscriptions: Array<() => void> = [];
  let deviceTeardown: Promise<void> | null = null;
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let discovery: Promise<void> | null = null;
  let recordLit = false;
  let generation = 0;

  const dispatch = (actionId: AgentRunActionId, payload?: unknown): void => {
    void Promise.resolve()
      .then(() => payload === undefined
        ? dispatchAction(actionId)
        : dispatchAction(actionId, payload))
      .catch(() => {});
  };

  const disconnect = (target: LaunchkeyMiniMK3): Promise<void> => {
    if (device !== target) return deviceTeardown ?? Promise.resolve();
    device = null;
    for (const unsubscribe of deviceSubscriptions.splice(0)) unsubscribe();
    let pending: void | Promise<void>;
    try {
      pending = target.disconnect();
    } catch {
      pending = undefined;
    }
    const teardown = Promise.resolve(pending).then(() => {}, () => {});
    deviceTeardown = teardown;
    void teardown.then(() => {
      if (deviceTeardown === teardown) deviceTeardown = null;
    });
    return teardown;
  };

  const routePad = (
    event: PadEvent,
    projection: ReturnType<typeof createRunPadProjection>,
  ): void => {
    if (event.mode !== "session" || event.action !== "down") return;
    const runId = projection.press(event.pad);
    if (runId) {
      dispatch(AGENT_RUN_ACTIONS.focusAgentRun, { runId });
    }
  };

  const routeButton = (
    event: ButtonEvent,
    connected: LaunchkeyMiniMK3,
  ): void => {
    if (event.action !== "down") return;
    if (event.button === "record") {
      recordLit = !recordLit;
      connected.output.raw.send("daw", [0xbf, 117, recordLit ? 127 : 0]);
      dispatch(AGENT_RUN_ACTIONS.toggleVoiceTranscription);
    } else if (event.button === "play") {
      dispatch(AGENT_RUN_ACTIONS.submitSelectedRunTerminal);
    }
  };

  const bind = (connected: LaunchkeyMiniMK3): void => {
    const projection = createRunPadProjection(connected.output.pads);
    projection.update(readStatus());
    if (recordLit) {
      connected.output.raw.send("daw", [0xbf, 117, 127]);
    }
    deviceSubscriptions = [
      subscribeStatus(() => {
        if (device === connected) projection.update(readStatus());
      }),
      connected.input.on("pad", (event) => routePad(event, projection)),
      connected.input.on("button", (event) => routeButton(event, connected)),
      connected.on("connection", (event: unknown) => {
        if (
          event &&
          typeof event === "object" &&
          (event as { connected?: unknown }).connected === false
        ) {
          void disconnect(connected);
        }
      }),
    ];
  };

  const discover = async (): Promise<void> => {
    if (!active) return;
    try {
      const ports = await midi.listPorts();
      if (!active) return;
      const selection = selectLaunchkeyMiniMK3(ports);
      if (device?.connected && selection && stillPresent(device, ports)) return;
      if (device) await disconnect(device);
      if (deviceTeardown) await deviceTeardown;
      if (!active || !selection) return;
      const transport = await midi.connect({ ports: selection });
      const connected = await LaunchkeyMiniMK3.connect({ transport });
      if (!active || device) {
        await connected.disconnect();
        return;
      }
      device = connected;
      bind(connected);
    } catch {
      // Hardware discovery is optional and stays silent while absent.
    }
  };

  const poll = (): Promise<void> => {
    if (discovery) return discovery;
    discovery = discover().finally(() => {
      discovery = null;
    });
    return discovery;
  };

  return {
    async start() {
      if (active) return;
      active = true;
      generation += 1;
      await poll();
      if (!active || discoveryTimer) return;
      discoveryTimer = setInterval(() => void poll(), discoveryIntervalMs);
    },
    async stop() {
      active = false;
      const stoppedGeneration = ++generation;
      if (discoveryTimer) clearInterval(discoveryTimer);
      discoveryTimer = null;
      await discovery;
      if (generation !== stoppedGeneration) return;
      if (device) await disconnect(device);
      if (deviceTeardown) await deviceTeardown;
    },
  };
}
