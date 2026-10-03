import { describe, expect, it, vi } from "vitest";

import { createDesktopRuntime } from "./desktopRuntime";
import { parsePlannerEndpoint } from "./plannerEndpoint";

const endpoint = { graphqlUrl: "http://127.0.0.1:43210/graphql", bearerToken: "a".repeat(32) };
const health = { state: "ready", service: "runtime", message: null, logPointer: null };

describe("planner endpoint discovery", () => {
  it("reads the ready instance after the renderer has opened during startup", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ serviceHealth: { ...health, state: "starting" }, initialNotices: [], plannerEndpoint: null })
      .mockResolvedValueOnce({ serviceHealth: health, initialNotices: [], plannerEndpoint: endpoint })
      .mockResolvedValueOnce({ serviceHealth: health, initialNotices: [], plannerEndpoint: { ...endpoint, bearerToken: "b".repeat(32) } });
    const runtime = await createDesktopRuntime({ invoke });
    expect(runtime.startup().plannerEndpoint).toBeNull();
    await expect(runtime.plannerEndpoint?.()).resolves.toEqual(endpoint);
    await expect(runtime.plannerEndpoint?.()).resolves.toEqual({ ...endpoint, bearerToken: "b".repeat(32) });
    expect(invoke.mock.calls.every(([command]) => command === "desktop_runtime_configuration")).toBe(true);
  });

  it.each([
    { ...endpoint, graphqlUrl: "https://example.com/graphql" },
    { ...endpoint, graphqlUrl: "http://127.0.0.1:43210/other" },
    { ...endpoint, graphqlUrl: "http://127.0.0.1:0/graphql" },
    { ...endpoint, graphqlUrl: "http://user:password@127.0.0.1:43210/graphql" },
    { ...endpoint, bearerToken: "" },
    { graphqlUrl: endpoint.graphqlUrl },
  ])("rejects invalid metadata at the native boundary", (value) => {
    expect(() => parsePlannerEndpoint(value)).toThrow("Invalid Studio runtime configuration");
  });

  it("accepts the configured default HTTP port", () => {
    expect(parsePlannerEndpoint({ ...endpoint, graphqlUrl: "http://127.0.0.1:80/graphql" })).toEqual({ ...endpoint, graphqlUrl: "http://127.0.0.1:80/graphql" });
  });

  it("reports an unavailable listener without retaining an old credential", () => {
    expect(parsePlannerEndpoint(null)).toBeNull();
  });
});
