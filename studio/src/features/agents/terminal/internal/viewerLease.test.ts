import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { desktopViewerLease } from "./viewerLease";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("desktop viewer lease authentication", () => {
  it("sends the runtime API key when acquiring a lease", async () => {
    vi.stubEnv("VITE_WT_API_KEY", "desktop-viewer-secret");

    await desktopViewerLease.acquire("run-1", "viewer-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/terminals/viewers/lease");
    expect(new Headers(init.headers).get("x-api-key")).toBe(
      "desktop-viewer-secret",
    );
  });

  it("omits the API key when the runtime key is empty", async () => {
    await desktopViewerLease.acquire("run-1", "viewer-1");

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).has("x-api-key")).toBe(false);
  });
});
