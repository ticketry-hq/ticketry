/**
 * CODING-1304 — the experiment must fail into the compatibility renderer, not
 * into a broken terminal. A missing or unusable wasm artifact is a supported
 * posture: the surface reports it, tears its own DOM down, and never attaches
 * a viewer to the durable run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { openGhosttyWasmSurface } from "./surface";
import { resetGhosttyVtRuntime } from "./wasmRuntime";
import type { TerminalClientTransport } from "../../internal/terminalClient";

function neverAttaches(): TerminalClientTransport {
  return {
    attach: vi.fn(() => {
      throw new Error("the viewer must not be attached when the renderer cannot load");
    }),
  };
}

afterEach(() => {
  resetGhosttyVtRuntime();
  vi.unstubAllGlobals();
});

describe("ghostty-wasm surface load failures", () => {
  it("reports a missing artifact and attaches no viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const onFailure = vi.fn();
    const transport = neverAttaches();

    openGhosttyWasmSurface({ agentRunId: "run-1", host, transport, onFailure });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());

    expect(onFailure.mock.calls[0][0]).toBe("wasm_artifact_unavailable");
    expect(transport.attach).not.toHaveBeenCalled();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("reports an artifact that is not valid WebAssembly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 })),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const onFailure = vi.fn();

    openGhosttyWasmSurface({
      agentRunId: "run-2",
      host,
      transport: neverAttaches(),
      onFailure,
    });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());

    expect(onFailure.mock.calls[0][0]).toBe("wasm_instantiation_failed");
  });

  it("does not cache a failed load, so a later retry can succeed", async () => {
    const fetchStub = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchStub);
    const host = document.createElement("div");
    document.body.append(host);

    for (const runId of ["run-3", "run-4"]) {
      const onFailure = vi.fn();
      openGhosttyWasmSurface({
        agentRunId: runId,
        host,
        transport: neverAttaches(),
        onFailure,
      });
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalled());
    }

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
