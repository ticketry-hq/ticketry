import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getProviderCatalog: vi.fn(),
  getLaunchProviderCapabilities: vi.fn(),
}));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...catalogApi,
}));

import { providerListPlaceholder } from "../features/workflows/launchProviderCatalog";
import { loadProviderCapabilities } from "../features/workflows/providerQueries";
import { queryClient } from "../shared/query/queryClient";

const capability = (agent: string) => ({
  agent,
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: [],
  model_prefixes: [],
  reasoning_levels: [],
});

describe("provider capabilities query", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    queryClient.removeQueries();
    catalogApi.getProviderCatalog.mockResolvedValue({
      value: { activated_providers: ["claude"], global_default: null },
    });
  });

  it("coalesces concurrent reads onto one request", async () => {
    catalogApi.getLaunchProviderCapabilities.mockResolvedValue([
      capability("claude"),
    ]);

    await Promise.all([
      loadProviderCapabilities(),
      loadProviderCapabilities(),
    ]);

    expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(1);
    expect(catalogApi.getProviderCatalog).toHaveBeenCalledTimes(1);
  });

  it("cancels an older read before a forced post-write refresh", async () => {
    let resolveStale: (value: unknown) => void = () => {};
    catalogApi.getLaunchProviderCapabilities
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValueOnce([capability("claude")]);

    const stale = loadProviderCapabilities();
    const fresh = await loadProviderCapabilities({ force: true });
    resolveStale([capability("claude"), capability("gemini")]);
    await stale.catch(() => undefined);

    expect(fresh.map((entry) => entry.agent)).toEqual(["claude"]);
    expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(2);
    expect(catalogApi.getProviderCatalog).toHaveBeenCalledTimes(2);
  });

  it("distinguishes loading, a dead fetch, and nothing activated", () => {
    expect(providerListPlaceholder({ loaded: false, failed: false }))
      .toBe("Loading providers…");
    expect(providerListPlaceholder({ loaded: false, failed: true }))
      .toBe("Providers unavailable — retry.");
    expect(providerListPlaceholder({ loaded: true, failed: false }))
      .toContain("No activated providers");
  });
});
