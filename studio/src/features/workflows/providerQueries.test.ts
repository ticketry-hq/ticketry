import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime, initializeStudioRuntime } from "../../runtime";
import { documentOperationName } from "../../graphql-foundation/typedDocument";
import { installDesktopGraphQlRuntime } from "../../test/desktopGraphQlRuntime";
import {
  getProviderCapabilitiesSnapshot,
  prefetchProviderCatalog,
} from "./providerQueries";

const provider = (slug: string) => ({
  __typename: "WorktrackerProvider",
  id: slug,
  slug,
  activated: true,
  supports_unattended: true,
});

const catalogPayload = {
  provider_catalog: {
    __typename: "ProviderCatalog",
    configurable_providers: [provider("claude"), provider("codex")],
    providers: [provider("claude"), provider("codex")],
    agent_models: [],
    reasoning_levels: [],
    global_default: null,
  },
};

const activatedSlugs = () =>
  getProviderCapabilitiesSnapshot()?.map((capability) => capability.agent);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("provider catalog warm", () => {
  afterEach(() => {
    initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
  });

  it("leaves the catalog readable from the cache after one round trip", async () => {
    const recorded = installDesktopGraphQlRuntime(async (document) =>
      (documentOperationName(document) === "LoadProviderCatalog"
        ? catalogPayload
        : {}) as never,
    );
    const catalogLoads = () =>
      recorded.filter((operation) => operation.operationName === "LoadProviderCatalog");
    expect(activatedSlugs()).toBeUndefined();

    prefetchProviderCatalog();

    // A launch surface mounting after this reads the holding synchronously,
    // so it never renders the "Loading providers…" placeholder.
    await vi.waitFor(() => expect(activatedSlugs()).toEqual(["claude", "codex"]));
    expect(catalogLoads()).toHaveLength(1);

    // Cache-first: a warmed catalog costs a later warm nothing.
    prefetchProviderCatalog();
    await flush();
    expect(catalogLoads()).toHaveLength(1);
    expect(activatedSlugs()).toEqual(["claude", "codex"]);
  });

  it("swallows a failed warm and retries it on the next call", async () => {
    let attempts = 0;
    installDesktopGraphQlRuntime(async (document) => {
      if (documentOperationName(document) !== "LoadProviderCatalog") return {} as never;
      attempts += 1;
      if (attempts === 1) throw new Error("provider catalog unavailable");
      return catalogPayload as never;
    });

    prefetchProviderCatalog();
    await vi.waitFor(() => expect(attempts).toBe(1));
    await flush();
    expect(activatedSlugs()).toBeUndefined();

    prefetchProviderCatalog();

    await vi.waitFor(() => expect(activatedSlugs()).toEqual(["claude", "codex"]));
  });
});
