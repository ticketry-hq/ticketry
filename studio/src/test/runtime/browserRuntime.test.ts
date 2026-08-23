import { describe, expect, it } from "vitest";
import { createBrowserRuntime } from "../../runtime/browserRuntime";

describe("browser runtime contract", () => {
  it("preserves Studio's relative browser endpoints and startup values", () => {
    const runtime = createBrowserRuntime({
      environment: {},
    });

    expect(runtime.platform).toBe("browser");
    expect(runtime.startup()).toEqual({
      serviceHealth: {
        state: "ready",
        service: "rust-graphql-adapter",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
  });

  it("reports browser-supported and native-only capabilities", async () => {
    const runtime = createBrowserRuntime({
      environment: {},
    });

    expect(runtime.capabilities).toEqual({
      // The status WebSocket was retired and the browser has no in-process
      // GraphQL transport, so it honestly reports no status feed at all.
      statusFeed: false,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
    });
    await expect(runtime.pickFolder()).resolves.toBeNull();
  });

  it("accepts an absolute Rust GraphQL adapter endpoint", () => {
    const runtime = createBrowserRuntime({
      environment: {
        VITE_GRAPHQL_API: "https://runtime.example.test/graphql",
      },
    });

    expect(runtime.startup()).toEqual({
      serviceHealth: {
        state: "ready",
        service: "rust-graphql-adapter",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
  });

  it("rejects invalid browser endpoint configuration", () => {
    expect(() =>
      createBrowserRuntime({
        environment: { VITE_GRAPHQL_API: "ftp://runtime.example.test/graphql" },
      }),
    ).toThrowError(
      "Invalid Studio runtime configuration: graphQlApi must be a relative path or an HTTP(S) URL",
    );
  });

  it("defaults to an empty startup and subscription notice source", () => {
    const runtime = createBrowserRuntime({ environment: {} });
    let delivered = false;

    expect(runtime.startup().initialNotices).toEqual([]);
    expect(runtime.subscribeUserNotices(() => {
      delivered = true;
    })).toEqual(expect.any(Function));
    expect(delivered).toBe(false);
  });
});
