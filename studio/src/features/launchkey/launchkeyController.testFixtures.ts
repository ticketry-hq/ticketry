import type {
  MidiTransport,
  PortDescription,
  RawMidiEvent,
} from "@bandwati/launchkey-adaptor";
import { vi } from "vitest";

import type { AgentStatusData, RunRecord } from "../agents/status";
import type {
  LaunchkeyMidiPorts,
  LaunchkeyMidiRuntime,
  LaunchkeyMidiSelection,
} from "../../runtime";
import { createLaunchkeyController } from "./launchkeyController";

export const DISCOVERY_INTERVAL_MS = 2_000;

export const NO_PORTS: LaunchkeyMidiPorts = Object.freeze({
  inputs: [],
  outputs: [],
});

export const LAUNCHKEY_MINI_MK3_PORTS: LaunchkeyMidiPorts = Object.freeze({
  inputs: [
    { id: "launchkey-mini-mk3-midi-in", name: "Launchkey Mini MK3 MIDI In" },
    { id: "launchkey-mini-mk3-daw-in", name: "Launchkey Mini MK3 DAW In" },
  ],
  outputs: [
    { id: "launchkey-mini-mk3-midi-out", name: "Launchkey Mini MK3 MIDI Out" },
    { id: "launchkey-mini-mk3-daw-out", name: "Launchkey Mini MK3 DAW Out" },
  ],
});

export class MemoryMidiTransport implements MidiTransport {
  connected = true;
  readonly sent: Array<{ port: "midi" | "daw"; data: number[] }> = [];
  readonly ports: Record<string, PortDescription | null> = {
    midiInput: LAUNCHKEY_MINI_MK3_PORTS.inputs[0] ?? null,
    dawInput: LAUNCHKEY_MINI_MK3_PORTS.inputs[1] ?? null,
    midiOutput: LAUNCHKEY_MINI_MK3_PORTS.outputs[0] ?? null,
    dawOutput: LAUNCHKEY_MINI_MK3_PORTS.outputs[1] ?? null,
  };
  disconnectCalls = 0;

  private readonly messageListeners = new Set<(event: RawMidiEvent) => void>();
  private readonly stateListeners = new Set<(event: unknown) => void>();

  onMessage(listener: (event: RawMidiEvent) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (event: unknown) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  send(port: "midi" | "daw", data: number[]): void {
    this.sent.push({ port, data: [...data] });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }

  loseConnection(): void {
    this.connected = false;
    for (const listener of [...this.stateListeners]) {
      listener({ connected: false, ports: null });
    }
  }

  loseConnectionSilently(): void {
    this.connected = false;
  }

  receive(port: "midi" | "daw", data: number[]): void {
    for (const listener of [...this.messageListeners]) {
      listener({ port, data: [...data] });
    }
  }
}

export class DeferredDisconnectMidiTransport extends MemoryMidiTransport {
  private finishPendingDisconnect: (() => void) | null = null;

  override async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
    await new Promise<void>((resolve) => {
      this.finishPendingDisconnect = resolve;
    });
  }

  finishDisconnect(): void {
    const finish = this.finishPendingDisconnect;
    if (!finish) throw new Error("Expected disconnect to be pending");
    this.finishPendingDisconnect = null;
    finish();
  }
}

export class MemoryMidiRuntime implements LaunchkeyMidiRuntime {
  availablePorts: LaunchkeyMidiPorts = NO_PORTS;
  readonly connectedTransports: MemoryMidiTransport[] = [];
  readonly connectSelections: Array<LaunchkeyMidiSelection | undefined> = [];
  listPortsCalls = 0;

  async listPorts(): Promise<LaunchkeyMidiPorts> {
    this.listPortsCalls += 1;
    return this.availablePorts;
  }

  async connect(options?: {
    readonly ports?: LaunchkeyMidiSelection;
  }): Promise<MidiTransport> {
    this.connectSelections.push(options?.ports);
    const transport = new MemoryMidiTransport();
    this.connectedTransports.push(transport);
    return transport;
  }
}

export class DeferredDiscoveryMidiRuntime extends MemoryMidiRuntime {
  private resolvePorts: ((ports: LaunchkeyMidiPorts) => void) | null = null;

  override listPorts(): Promise<LaunchkeyMidiPorts> {
    this.listPortsCalls += 1;
    return new Promise((resolve) => {
      this.resolvePorts = resolve;
    });
  }

  finishDiscovery(ports: LaunchkeyMidiPorts): void {
    const resolve = this.resolvePorts;
    if (!resolve) throw new Error("Expected discovery to be pending");
    this.resolvePorts = null;
    resolve(ports);
  }
}

export class DeferredDisconnectMidiRuntime extends MemoryMidiRuntime {
  readonly transport = new DeferredDisconnectMidiTransport();

  override async connect(options?: {
    readonly ports?: LaunchkeyMidiSelection;
  }): Promise<MidiTransport> {
    this.connectSelections.push(options?.ports);
    this.connectedTransports.push(this.transport);
    return this.transport;
  }
}

export class MemoryStatusHolding {
  private readonly listeners = new Set<() => void>();

  constructor(private current: AgentStatusData) {}

  readonly read = (): AgentStatusData => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(current: AgentStatusData): void {
    this.current = current;
    for (const listener of [...this.listeners]) listener();
  }
}

export function agentRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    agent_run_id: "run-1",
    project_id: "project-1",
    task_id: "task-1",
    module_id: "module-1",
    agent: "codex",
    scope: "task",
    started_at: "2026-09-04T08:00:00.000Z",
    state: "working",
    updated_at: "2026-09-04T08:00:01.000Z",
    ...overrides,
  };
}

export function agentStatusHolding(
  runs: readonly RunRecord[],
): AgentStatusData {
  return {
    projectId: "project-1",
    runs: Object.fromEntries(runs.map((record) => [record.agent_run_id, record])),
    automationAttempts: {},
    automationByTask: {},
    stallEpoch: 0,
  };
}

export async function settleInput(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export async function startConnectedController(
  runs: readonly RunRecord[] = [],
) {
  const midi = new MemoryMidiRuntime();
  midi.availablePorts = LAUNCHKEY_MINI_MK3_PORTS;
  const status = new MemoryStatusHolding(agentStatusHolding(runs));
  const dispatchAction = vi.fn(async () => true);
  const controller = createLaunchkeyController({
    midi,
    discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
    readStatus: status.read,
    subscribeStatus: status.subscribe,
    dispatchAction,
  });

  await controller.start();
  const transport = midi.connectedTransports[0];
  if (!transport) throw new Error("Expected the Launchkey to connect");
  transport.sent.length = 0;
  return { controller, dispatchAction, midi, status, transport };
}
