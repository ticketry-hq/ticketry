/**
 * The surface used to hold one `TerminalClient` forever: a viewer that ended
 * stayed installed, `attachClient` early-returned on the dead reference, and
 * the terminal looked attached while swallowing every keystroke. These cases
 * pin the released-and-replaced behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  TerminalClient,
  TerminalClientEvent,
  TerminalClientTransport,
} from "../../internal/terminalClient";
import { openGhosttyWasmSurface } from "./surface";

const doubles = vi.hoisted(() => ({
  core: {
    clean: vi.fn(),
    dispose: vi.fn(),
    frame: vi.fn(() => ({ dirty: "none" })),
    handle: 1,
    markDirty: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  },
  renderer: {
    metrics: { width: 8, height: 16 },
    paint: vi.fn(),
    resizeTo: vi.fn(() => ({ cols: 80, rows: 24 })),
  },
}));

vi.mock("./wasmRuntime", () => ({
  GhosttyWasmLoadError: class extends Error {},
  loadGhosttyVtRuntime: vi.fn(async () => ({
    exports: { memory: { buffer: new ArrayBuffer(64) } },
  })),
}));

vi.mock("./canvasRenderer", () => ({
  TerminalCanvasRenderer: class {
    constructor() {
      return doubles.renderer;
    }
  },
}));

vi.mock("./terminalCore", () => ({
  GhosttyVtTerminal: class {
    constructor() {
      return doubles.core;
    }
  },
}));

vi.mock("./keyEncoder", () => ({
  GhosttyKeyEncoder: class {
    dispose() {}
    encode() {
      return new Uint8Array([0x61]);
    }
  },
}));

vi.mock("./mouseEncoder", () => ({
  GhosttyMouseEncoder: class {
    dispose() {}
    setViewport() {}
  },
}));

vi.mock("./wheelPolicy", () => ({
  GhosttyWheelPolicy: class {
    reconcile() {}
    snapToBottom() {}
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

interface Harness {
  readonly clients: TerminalClient[];
  emit(event: TerminalClientEvent): void;
  readonly transport: TerminalClientTransport;
}

function harness(): Harness {
  const clients: TerminalClient[] = [];
  let emit: (event: TerminalClientEvent) => void = () => {
    throw new Error("terminal transport did not attach");
  };
  const transport: TerminalClientTransport = {
    attach: vi.fn((_params, onEvent) => {
      emit = onEvent;
      const client: TerminalClient = {
        detach: vi.fn(),
        input: vi.fn(),
        resize: vi.fn(),
        resume: vi.fn(),
        scroll: vi.fn(),
        status: vi.fn(() => "ready" as const),
        suspend: vi.fn(() => true),
      };
      clients.push(client);
      return client;
    }),
  };
  return {
    clients,
    emit: (event) => emit(event),
    transport,
  };
}

async function openSurface(bridge: Harness, active = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const surface = openGhosttyWasmSurface({
    active,
    agentRunId: "run-1",
    host,
    transport: bridge.transport,
  });
  if (active) {
    await vi.waitFor(() => expect(bridge.transport.attach).toHaveBeenCalledTimes(1));
  }
  return { host, surface };
}

const ready: TerminalClientEvent = {
  type: "ready",
  sessionId: "viewer-1",
  agentRunId: "run-1",
};

const transportClosed: TerminalClientEvent = {
  type: "closed",
  reason: "transport_closed",
  code: 0,
  detail: "transport_closed",
};

describe("ghostty-wasm surface viewer recovery", () => {
  it("(a) replaces a viewer whose transport closed while presented", async () => {
    const bridge = harness();
    const { host } = await openSurface(bridge);
    bridge.emit(ready);

    bridge.emit(transportClosed);

    expect(bridge.transport.attach).toHaveBeenCalledTimes(2);
    expect(bridge.clients[0].detach).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("(b) drops a viewer that ended while hidden and reattaches on return", async () => {
    const bridge = harness();
    const { host, surface } = await openSurface(bridge);
    bridge.emit(ready);
    surface.setActive(false);

    bridge.emit(transportClosed);
    expect(bridge.transport.attach).toHaveBeenCalledTimes(1);
    expect(bridge.clients[0].detach).toHaveBeenCalledTimes(1);

    surface.setActive(true);
    expect(bridge.transport.attach).toHaveBeenCalledTimes(2);
    host.remove();
  });

  it("(c) never reattaches once the durable run has ended", async () => {
    const bridge = harness();
    const { host, surface } = await openSurface(bridge);
    bridge.emit(ready);

    bridge.emit({ type: "reattachment_required", reason: "session_ended" });

    expect(bridge.transport.attach).toHaveBeenCalledTimes(1);
    surface.setActive(false);
    surface.setActive(true);
    host.querySelector<HTMLTextAreaElement>("textarea")?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a" }),
    );
    expect(bridge.transport.attach).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("(d) reclaims a lease lost to another window on the next keystroke", async () => {
    const bridge = harness();
    const { host } = await openSurface(bridge);
    bridge.emit(ready);

    bridge.emit({ type: "reattachment_required", reason: "replaced_by_another_viewer" });
    expect(bridge.transport.attach).toHaveBeenCalledTimes(1);
    expect(bridge.clients[0].detach).toHaveBeenCalledTimes(1);

    const input = host.querySelector<HTMLTextAreaElement>("textarea");
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(bridge.transport.attach).toHaveBeenCalledTimes(2);
    expect(bridge.clients[1].input).toHaveBeenCalledWith(new Uint8Array([0x61]));
    host.remove();
  });
});
