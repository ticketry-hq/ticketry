/**
 * A lease renewal that loses ownership arrives as the `ApiError` that
 * `graphQlMutationError` builds, not as a bare `{ code }`. The client read only
 * the bare shape, so a viewer replaced by another window renewed a lease it no
 * longer held and never told its host to reattach.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../../shared/api/errors";
import { openTauriTerminalClient } from "./tauriTerminalClient";
import type { TauriViewerBridge } from "./tauriTerminalClient";
import type { TerminalClientEvent } from "./terminalClient";
import type { ViewerLeaseClient } from "./viewerLease";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: unknown = null;
  },
  invoke: vi.fn(async () => {
    throw new Error("no Tauri host in this test");
  }),
}));

function fakeBridge(): TauriViewerBridge {
  return {
    attach: vi.fn(async () => ({
      viewerHandle: "viewer-handle",
      runId: "run-1",
      lifecycle: "attached" as const,
    })),
    detach: vi.fn(async () => ({
      viewerHandle: "viewer-handle",
      runId: "run-1",
      lifecycle: "closed" as const,
    })),
    input: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
  };
}

function fakeLeaseClient(renew: () => Promise<void>): ViewerLeaseClient {
  return {
    acquire: vi.fn(async () => ({ generation: "gen-1" })),
    release: vi.fn(async () => {}),
    renew: vi.fn(renew),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function attachedClient(renew: () => Promise<void>) {
  const events: TerminalClientEvent[] = [];
  const bridge = fakeBridge();
  const client = openTauriTerminalClient(
    { agentRunId: "run-1", cols: 80, rows: 24 },
    (event) => events.push(event),
    bridge,
    fakeLeaseClient(renew),
  );
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === "ready")).toBe(true);
  });
  return { bridge, client, events };
}

describe("tauri terminal client lease renewal", () => {
  it("reattaches when a renewal reports the lease is no longer owned", async () => {
    const { bridge, client, events } = await attachedClient(async () => {
      throw new ApiError(409, "viewer lease not owned", {
        detail: "viewer lease not owned",
        code: "viewer_lease_not_owned",
      });
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(events.map((event) => event.type)).toContain("reattachment_required");
    const required = events.find((event) => event.type === "reattachment_required");
    expect(required).toMatchObject({ reason: "replaced_by_another_viewer" });
    expect(client.status()).toBe("reattachment_required");
    expect(bridge.detach).toHaveBeenCalledWith("viewer-handle");
  });

  it("keeps the viewer when renewals succeed", async () => {
    const { client, events } = await attachedClient(async () => {});

    await vi.advanceTimersByTimeAsync(30_000);

    expect(events.some((event) => event.type === "reattachment_required")).toBe(false);
    expect(client.status()).toBe("ready");
  });

  it("keeps the viewer when a renewal fails for an unrelated reason", async () => {
    const { client, events } = await attachedClient(async () => {
      throw new ApiError(503, "storage unavailable", { code: "storage_unavailable" });
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(events.some((event) => event.type === "reattachment_required")).toBe(false);
    expect(client.status()).toBe("ready");
  });
});
