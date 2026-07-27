import { expect, it } from "vitest";

import type {
  TerminalClientEvent,
  TerminalClientTransport,
} from "../../features/agents/terminal/internal/terminalClient";

export interface TerminalClientContractHarness {
  transport: TerminalClientTransport;
  connect(): Promise<void>;
  output(value: Uint8Array): void;
  missingSession(): Promise<void>;
  operations(): TerminalClientOperation[];
}

export type TerminalClientOperation =
  | { type: "input"; bytes: Uint8Array }
  | { type: "resize"; cols: number; rows: number }
  | { type: "scroll"; direction: "up" | "down"; lines: number };

/** Shared lifecycle assertions for every terminal-client transport adapter. */
export function terminalClientContractSuite(createHarness: () => TerminalClientContractHarness): void {
  it("attaches, routes terminal operations, and reports output", async () => {
    const harness = createHarness();
    const events: TerminalClientEvent[] = [];
    const client = harness.transport.attach({ agentRunId: "run-1", cols: 80, rows: 24 }, (event) => events.push(event));
    await harness.connect();
    harness.output(new Uint8Array([65]));
    client.input(new Uint8Array([66]));
    client.resize(100, 40);
    client.scroll("up", 3);

    expect(events).toContainEqual({ type: "ready", sessionId: "viewer-1", agentRunId: "run-1" });
    expect(events).toContainEqual({ type: "output", bytes: new Uint8Array([65]) });
    expect(harness.operations()).toEqual(expect.arrayContaining([
      { type: "input", bytes: new Uint8Array([66]) },
      { type: "resize", cols: 100, rows: 40 },
      { type: "scroll", direction: "up", lines: 3 },
    ]));
  });

  it("keeps suspend/resume distinct from EOF and viewer exit", async () => {
    const harness = createHarness();
    const events: TerminalClientEvent[] = [];
    const client = harness.transport.attach({ agentRunId: "run-1", cols: 80, rows: 24 }, (event) => events.push(event));
    await harness.connect();
    expect(client.suspend()).toBe(true);
    expect(events).toContainEqual({ type: "suspended" });
    expect(events.some((event) => event.type === "eof")).toBe(false);

    client.resume();
    await harness.connect();
    expect(events).toContainEqual({ type: "resumed" });
  });

  it("identifies a missing durable run as requiring reattachment", async () => {
    const harness = createHarness();
    const events: TerminalClientEvent[] = [];
    harness.transport.attach({ agentRunId: "gone", cols: 80, rows: 24 }, (event) => events.push(event));
    await harness.missingSession();
    expect(events).toContainEqual({ type: "reattachment_required", reason: "session_not_found" });
  });
}
