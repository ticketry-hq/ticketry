import { describe, expect, it, vi } from "vitest";

import {
  GhosttyWasmLoadError,
  loadGhosttyVtArtifact,
} from "./wasmRuntime";

describe("ghostty-vt artifact loading", () => {
  it("reads the embedded bytes through Tauri in a packaged desktop build", async () => {
    const fetchArtifact = vi.fn();
    const invokeArtifact = vi.fn(async () => new Uint8Array([0, 97, 115, 109]));

    const artifact = await loadGhosttyVtArtifact("/ignored.wasm", {
      packagedDesktop: true,
      invokeArtifact,
      fetchArtifact,
    });

    expect([...new Uint8Array(artifact)]).toEqual([0, 97, 115, 109]);
    expect(invokeArtifact).toHaveBeenCalledOnce();
    expect(fetchArtifact).not.toHaveBeenCalled();
  });

  it("keeps HTTP loading for browser and development builds", async () => {
    const invokeArtifact = vi.fn();
    const fetchArtifact = vi.fn(async () =>
      new Response(new Uint8Array([0, 97, 115, 109]), { status: 200 })
    );

    const artifact = await loadGhosttyVtArtifact("/ghostty-vt/test.wasm", {
      packagedDesktop: false,
      invokeArtifact,
      fetchArtifact,
    });

    expect([...new Uint8Array(artifact)]).toEqual([0, 97, 115, 109]);
    expect(fetchArtifact).toHaveBeenCalledWith("/ghostty-vt/test.wasm");
    expect(invokeArtifact).not.toHaveBeenCalled();
  });

  it("reports a packaged asset failure without claiming an HTTP fetch failed", async () => {
    const failure = loadGhosttyVtArtifact(undefined, {
      packagedDesktop: true,
      invokeArtifact: async () => {
        throw new Error("missing embedded asset");
      },
    });

    await expect(failure).rejects.toMatchObject({
      failure: "artifact_unavailable",
      message: "ghostty-vt artifact could not be loaded from the packaged application",
    } satisfies Partial<GhosttyWasmLoadError>);
  });
});
