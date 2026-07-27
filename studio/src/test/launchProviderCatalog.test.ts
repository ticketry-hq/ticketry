import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogApi = vi.hoisted(() => ({
  getLaunchProviderCapabilities: vi.fn(),
}));

vi.mock("../features/studio/workflowApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/studio/workflowApi")>()),
  ...catalogApi,
}));

import {
  ensureLaunchProviderCatalog,
  fetchLaunchProviderCatalog,
  providerListPlaceholder,
  useLaunchProviderCatalog,
} from "../features/workflows/launchProviderCatalog";

const capability = (agent: string) => ({
  agent,
  accepts_model: true,
  accepts_any_model: false,
  model_aliases: [],
  model_prefixes: [],
  reasoning_levels: [],
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("launchProviderCatalog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useLaunchProviderCatalog.setState({
      capabilities: [],
      loaded: false,
      failed: false,
    });
  });

  it("coalesces concurrent read-only fetches onto one request", async () => {
    catalogApi.getLaunchProviderCapabilities.mockResolvedValue([
      capability("claude"),
    ]);

    await Promise.all([
      fetchLaunchProviderCatalog(),
      fetchLaunchProviderCatalog(),
    ]);

    expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(1);
  });

  it("does not hand a writer a response that predates its write", async () => {
    // The read-only GET started before the PUT committed, so returning it as-is
    // would publish the pre-save activation set as authoritative.
    let resolveStale: (value: unknown) => void = () => {};
    const responses = [
      () => new Promise((resolve) => {
        resolveStale = resolve;
      }),
      async () => [capability("claude")],
    ];
    catalogApi.getLaunchProviderCapabilities.mockImplementation(() =>
      (responses.shift() ?? (async () => []))());

    const stale = fetchLaunchProviderCatalog();
    const fresh = await fetchLaunchProviderCatalog({ force: true });
    resolveStale([capability("claude"), capability("gemini")]);
    await stale;

    expect(fresh.map((c) => c.agent)).toEqual(["claude"]);
    expect(catalogApi.getLaunchProviderCapabilities).toHaveBeenCalledTimes(2);
  });

  it("records a failed fetch so an empty list is not read as an answer", async () => {
    catalogApi.getLaunchProviderCapabilities.mockRejectedValue(
      new Error("offline"),
    );

    ensureLaunchProviderCatalog();
    await flush();

    const state = useLaunchProviderCatalog.getState();
    expect(state.loaded).toBe(false);
    expect(state.failed).toBe(true);
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
