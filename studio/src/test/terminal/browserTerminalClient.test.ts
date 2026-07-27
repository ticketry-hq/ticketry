import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { browserTerminalClient } from "../../features/agents/terminal/internal/browserTerminalClient";
import { terminalClientContractSuite, type TerminalClientOperation } from "./terminalClientContractSuite";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(value: unknown): void {
    this.sent.push(value);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  text(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }

  bytes(value: Uint8Array): void {
    this.onmessage?.({ data: value.buffer } as MessageEvent);
  }
}

describe("browser terminal client adapter", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  terminalClientContractSuite(() => ({
    transport: browserTerminalClient,
    async connect() {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.open();
      expect(socket.sent).toContainEqual(JSON.stringify({
        type: "init",
        mode: "attach",
        agent_run_id: "run-1",
        cols: 80,
        rows: 24,
      }));
      socket.text({ type: "ready", session_id: "viewer-1", agent_run_id: "run-1" });
    },
    output(value) {
      FakeWebSocket.instances.at(-1)!.bytes(value);
    },
    async missingSession() {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.open();
      socket.text({ type: "error", message: "session_not_found" });
      socket.close(1008, "missing");
    },
    operations(): TerminalClientOperation[] {
      const sent = FakeWebSocket.instances.at(-1)!.sent;
      const operations: TerminalClientOperation[] = [];
      for (const value of sent) {
        if (value instanceof ArrayBuffer) {
          operations.push({ type: "input", bytes: new Uint8Array(value) });
          continue;
        }
        if (typeof value !== "string") continue;
        const frame = JSON.parse(value) as { type?: string; cols?: number; rows?: number; dir?: "up" | "down"; lines?: number };
        if (frame.type === "resize" && frame.cols !== undefined && frame.rows !== undefined) {
          operations.push({ type: "resize", cols: frame.cols, rows: frame.rows });
        }
        if (frame.type === "scroll" && frame.dir && frame.lines !== undefined) {
          operations.push({ type: "scroll", direction: frame.dir, lines: frame.lines });
        }
      }
      return operations;
    },
  }));
});
