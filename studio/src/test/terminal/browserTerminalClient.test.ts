import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initializeStudioRuntime } from "../../runtime";
import { createBrowserRuntime } from "../../runtime/browserRuntime";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  binaryType = "blob";
  readyState = FakeWebSocket.CONNECTING;
  sentText: string[] = [];
  sentBinary: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data === "string") this.sentText.push(data);
    else if (data instanceof ArrayBuffer) this.sentBinary.push(new Uint8Array(data));
    else this.sentBinary.push(data);
  }

  close(code = 1005, reason = ""): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.readyState = FakeWebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    });
  }

  open(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverText(text: string): void {
    this.onmessage?.({ data: text });
  }

  serverBytes(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes.slice().buffer });
  }
}

const READY = JSON.stringify({
  type: "ready",
  session_id: "srv-1",
  agent_run_id: "run-1",
});

interface ClientEventLike {
  type: string;
  attempt?: number;
  sessionId?: string;
  agentRunId?: string;
  bytes?: Uint8Array;
  layer?: string;
  message?: string;
  reason?: string;
  code?: number;
  detail?: string;
}

type BrowserModule = typeof import("../../features/agents/terminal/internal/browserTerminalClient");

let browserModule: BrowserModule;
let client: ReturnType<BrowserModule["browserTerminalClient"]["attach"]> | null = null;
let events: ClientEventLike[];

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  expect(socket).toBeDefined();
  return socket;
}

function attach(): void {
  client = browserModule.browserTerminalClient.attach(
    { agentRunId: "run-1", cols: 120, rows: 40 },
    (event) => events.push(event as ClientEventLike),
  );
}

/** Attach, open the socket, and deliver the ready frame. */
async function readySocket(): Promise<FakeWebSocket> {
  attach();
  const socket = lastSocket();
  socket.open();
  socket.serverText(READY);
  return socket;
}

async function loadModule(): Promise<void> {
  browserModule = await import(
    "../../features/agents/terminal/internal/browserTerminalClient"
  );
}

describe("browser terminal client", () => {
  beforeEach(() => {
    events = [];
    client = null;
    FakeWebSocket.instances = [];
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens the configured URL and sends the canonical attach init", async () => {
    await loadModule();
    attach();

    const socket = lastSocket();
    expect(socket.url).toBe("/ws/terminal");
    expect(socket.binaryType).toBe("arraybuffer");
    expect(events).toEqual([{ type: "connecting", attempt: 0 }]);
    socket.open();

    expect(socket.sentText).toEqual([
      JSON.stringify({
        type: "init",
        mode: "attach",
        agent_run_id: "run-1",
        cols: 120,
        rows: 40,
      }),
    ]);
  });

  it("binds a valid ready frame to the ready event", async () => {
    await loadModule();
    attach();
    const socket = lastSocket();
    socket.open();
    socket.serverText(READY);

    expect(events.map((event) => event.type)).toEqual(["connecting", "ready"]);
    expect(events[1]).toEqual({
      type: "ready",
      sessionId: "srv-1",
      agentRunId: "run-1",
    });
    expect(client?.status()).toBe("ready");
  });

  it("writes exact binary output slices", async () => {
    await loadModule();
    const socket = await readySocket();
    const payload = new TextEncoder().encode("\u001b[31mhello\u001b[0m");
    const padded = new Uint8Array(payload.length + 4);
    padded.set(payload, 2);

    socket.serverBytes(padded.subarray(2, payload.length + 2));

    const output = events.find((event) => event.type === "output");
    expect(Array.from(output?.bytes ?? [])).toEqual(Array.from(payload));
  });

  it("sends binary input and resize and scroll control frames", async () => {
    await loadModule();
    const socket = await readySocket();
    client?.input(new TextEncoder().encode("ls\r"));
    client?.resize(100, 30);
    client?.scroll("down", 3);

    expect(socket.sentBinary.length).toBe(1);
    expect(new TextDecoder().decode(socket.sentBinary[0])).toBe("ls\r");
    expect(socket.sentText.slice(1)).toEqual([
      JSON.stringify({ type: "resize", cols: 100, rows: 30 }),
      JSON.stringify({ type: "scroll", dir: "down", lines: 3 }),
    ]);
  });

  it("records geometry before open and never sends to a closed socket", async () => {
    await loadModule();
    attach();
    const first = lastSocket();

    expect(() => client?.resize(90, 28)).not.toThrow();
    expect(first.sentText).toEqual([]);

    first.open();
    expect(first.sentText[0]).toContain('"cols":90');

    first.readyState = FakeWebSocket.CLOSED;
    expect(() => client?.scroll("up", 2)).not.toThrow();
    expect(first.sentText.length).toBe(1);
  });

  it("classifies malformed and unknown text frames as protocol errors", async () => {
    await loadModule();
    const socket = await readySocket();
    socket.serverText("{not json");
    socket.serverText(JSON.stringify({ type: "mystery" }));

    const errors = events.filter((event) => event.type === "error");
    expect(errors).toEqual([
      { type: "error", layer: "protocol", message: "bad_json" },
      { type: "error", layer: "protocol", message: "unknown_frame" },
    ]);
  });

  it("maps session_not_found to a terminal session loss without retrying", async () => {
    await loadModule();
    const socket = await readySocket();
    // The server reports the failure, then closes the socket.
    socket.serverText(JSON.stringify({ type: "error", message: "session_not_found" }));
    socket.close(1008, "session_not_found");
    await flush();

    expect(lastSocket()).toBe(socket);
    expect(client?.status()).toBe("reattachment_required");
    const tail = events.slice(-2);
    expect(tail[0]).toEqual({
      type: "error",
      layer: "session",
      message: "session_not_found",
    });
    expect(tail[1]).toEqual({
      type: "reattachment_required",
      reason: "session_not_found",
    });
  });

  it("maps lease replacement to its own reattachment reason", async () => {
    await loadModule();
    const socket = await readySocket();
    socket.serverText(
      JSON.stringify({ type: "error", message: "replaced_by_another_viewer" }),
    );
    socket.close(4409, "replaced_by_another_viewer");
    await flush();

    expect(client?.status()).toBe("reattachment_required");
    expect(events.at(-1)).toEqual({
      type: "reattachment_required",
      reason: "replaced_by_another_viewer",
    });
  });

  it("treats a clean close after ready as eof plus viewer exit", async () => {
    await loadModule();
    const socket = await readySocket();
    socket.close(1000, "");
    await flush();

    expect(client?.status()).toBe("closed");
    expect(events.at(-2)?.type).toBe("eof");
    expect(events.at(-1)).toMatchObject({
      type: "closed",
      reason: "viewer_exit",
      code: 1000,
    });
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("never retries a transport that never became ready", async () => {
    await loadModule();
    attach();
    const socket = lastSocket();
    socket.open();
    socket.close(1006, "abnormal");
    await flush();

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(client?.status()).toBe("closed");
    expect(events.at(-1)).toMatchObject({
      type: "closed",
      reason: "transport_closed",
      code: 1006,
    });
  });

  it("reconnects a live session over bounded backoff and resets attempts", async () => {
    vi.useFakeTimers();
    await loadModule();
    attach();
    const first = lastSocket();
    first.open();
    first.serverText(READY);

    first.close(1011, "server error");
    await vi.advanceTimersByTimeAsync(700);

    const second = lastSocket();
    expect(second).not.toBe(first);
    second.open();
    second.serverText(READY);

    expect(second.sentText[0]).toContain('"agent_run_id":"run-1"');
    expect(client?.status()).toBe("ready");
    // A fresh ready frame resets the attempt counter.
    const connects = events.filter((event) => event.type === "connecting");
    expect(connects.map((event) => event.attempt)).toEqual([0, 1]);
  });

  it("exhausts the reconnect budget into reattachment_required", async () => {
    vi.useFakeTimers();
    await loadModule();
    attach();
    const first = lastSocket();
    first.open();
    first.serverText(READY);
    first.close(1011, "server error");

    for (let i = 0; i < 8; i += 1) {
      await vi.runAllTimersAsync();
      const socket = lastSocket();
      expect(FakeWebSocket.instances.length).toBe(i + 2);
      socket.readyState = FakeWebSocket.CLOSED;
      socket.onclose?.({ code: 1011, reason: "server error" });
    }
    await vi.runAllTimersAsync();

    expect(FakeWebSocket.instances.length).toBe(9);
    expect(client?.status()).toBe("reattachment_required");
    expect(events.at(-1)).toEqual({
      type: "reattachment_required",
      reason: "reconnect_exhausted",
    });
  }, 20_000);

  it("detaches exactly once, ignoring the trailing close callback", async () => {
    vi.useFakeTimers();
    await loadModule();
    const socket = await readySocket();

    client?.detach();
    await vi.runAllTimersAsync();

    expect(socket.sentBinary).toEqual([]);
    expect(events.filter((event) => event.type === "closed").length).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "closed",
      reason: "client_detach",
    });
    expect(client?.status()).toBe("closed");

    client?.detach();
    expect(events.filter((event) => event.type === "closed").length).toBe(1);
  });

  it("clears a pending reconnect timer when detaching mid-backoff", async () => {
    vi.useFakeTimers();
    await loadModule();
    attach();
    const first = lastSocket();
    first.open();
    first.serverText(READY);
    first.close(1011, "server error");

    client?.detach();
    await vi.runAllTimersAsync();

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(events.some((event) => event.type === "connecting" && event.attempt === 1)).toBe(false);
  });

  it("suspends only after ready and resumes through a fresh attach", async () => {
    await loadModule();
    attach();
    const pending = lastSocket();

    expect(client?.suspend()).toBe(false);

    pending.open();
    pending.serverText(READY);
    expect(client?.suspend()).toBe(true);
    expect(events.filter((event) => event.type === "suspended").length).toBe(1);
    expect(client?.status()).toBe("suspended");
    client?.input(new TextEncoder().encode("x"));
    expect(pending.sentBinary).toEqual([]);

    client?.resume();
    const resumed = lastSocket();
    expect(resumed).not.toBe(pending);
    resumed.open();
    resumed.serverText(READY);

    expect(resumed.sentText[0]).toContain('"mode":"attach"');
    expect(events.filter((event) => event.type === "resumed").length).toBe(1);
    resumed.serverBytes(new TextEncoder().encode("ok"));
    expect(events.filter((event) => event.type === "output").length).toBe(1);
  });
});
