import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserRuntime } from "../runtime/browserRuntime";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";

describe("Rust-only shipping caller acceptance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("[overhaul-158] sends browser development through the owned Rust GraphQL adapter with no REST fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { workspace: { nodes: [] } } }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const runtime = createBrowserRuntime({ environment: {} });
    const document: TypedDocumentNode<
      { workspace: { nodes: unknown[] } },
      Record<string, never>
    > = {
      kind: "Document",
      operationName: "BrowserRustContract",
      source: "query BrowserRustContract { workspace: worktrackerWorkspace { nodes { id } } }",
    };

    await expect(runtime.readWorkTracker({
      graphQl: (execute) => execute(document, {}),
    })).resolves.toEqual({ workspace: { nodes: [] } });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/graphql", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"operationName":"BrowserRustContract"'),
    }));
  });
});
