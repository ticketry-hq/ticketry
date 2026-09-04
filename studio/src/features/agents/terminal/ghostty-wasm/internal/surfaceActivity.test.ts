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
    markDirty: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  },
  coreConstructions: vi.fn(),
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
      doubles.coreConstructions();
      return doubles.core;
    }
  },
}));

vi.mock("./keyEncoder", () => ({
  GhosttyKeyEncoder: class {
    dispose() {}
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

describe("Ghostty WASM surface activity", () => {
  it("keeps one viewer and terminal core live while painting is hidden", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((handle) => {
      frames.delete(handle);
    });
    const paintFrames = () => {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(performance.now());
    };

    const client: TerminalClient = {
      detach: vi.fn(),
      input: vi.fn(),
      resize: vi.fn(),
      resume: vi.fn(),
      scroll: vi.fn(),
      status: vi.fn(() => "ready" as const),
      suspend: vi.fn(() => true),
    };
    let emit: (event: TerminalClientEvent) => void = () => {
      throw new Error("terminal transport did not attach");
    };
    const transport: TerminalClientTransport = {
      attach: vi.fn((_params, onEvent) => {
        emit = onEvent;
        return client;
      }),
    };
    const host = document.createElement("div");
    document.body.append(host);

    const surface = openGhosttyWasmSurface({
      active: true,
      agentRunId: "run-1",
      host,
      transport,
    });
    await vi.waitFor(() => expect(transport.attach).toHaveBeenCalledTimes(1));
    paintFrames();

    surface.setActive(false);
    const requestsBeforeHiddenOutput = nextFrame;
    emit({ type: "output", bytes: new Uint8Array([0x68, 0x69]) });

    expect(doubles.core.write).toHaveBeenCalledWith(new Uint8Array([0x68, 0x69]));
    expect(nextFrame).toBe(requestsBeforeHiddenOutput);
    expect(doubles.renderer.paint).not.toHaveBeenCalled();

    doubles.core.frame.mockReturnValueOnce({
      dirty: "full",
      rows: 1,
      dirtyRows: [{
        y: 0,
        cells: [{ text: "hi" }],
      }],
    } as never);
    surface.setActive(true);
    paintFrames();

    expect(client.suspend).not.toHaveBeenCalled();
    expect(client.resume).not.toHaveBeenCalled();
    expect(doubles.renderer.paint).toHaveBeenCalledTimes(1);
    expect(doubles.coreConstructions).toHaveBeenCalledTimes(1);
    expect(transport.attach).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).not.toBeNull();
    expect(host.querySelector('[data-testid="ghostty-wasm-output"]'))
      .toHaveTextContent("hi");

    surface.detach();
    expect(client.detach).toHaveBeenCalledTimes(1);
    expect(host.querySelector("canvas")).toBeNull();
    host.remove();
  });
});
