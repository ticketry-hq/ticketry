import { describe, expect, it } from "vitest";
import { createBrowserRuntime } from "../../runtime/browserRuntime";

describe("browser runtime contract", () => {
  it("preserves Studio's relative browser endpoints and startup values", () => {
    const runtime = createBrowserRuntime({
      environment: {},
    });

    expect(runtime.platform).toBe("browser");
    expect(runtime.startup()).toEqual({
      endpoints: {
        workTrackerApi: "/api/work-tracker",
        agentApi: "/api",
        statusApi: "/api",
        terminalWebSocket: "/ws/terminal",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: {
        state: "ready",
        service: "backend",
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
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
    });
    await expect(runtime.pickFolder()).resolves.toBeNull();
  });

  it("derives websocket origins from valid absolute browser API configuration", () => {
    const runtime = createBrowserRuntime({
      environment: {
        VITE_WT_API_BASE: "https://tracker.example.test/work-tracker",
        VITE_AGENT_API_BASE: "https://runtime.example.test/api",
        VITE_WT_API_KEY: "browser-token",
      },
    });

    expect(runtime.startup()).toEqual({
      endpoints: {
        workTrackerApi: "https://tracker.example.test/work-tracker",
        agentApi: "https://runtime.example.test/api",
        statusApi: "https://runtime.example.test/api",
        terminalWebSocket: "wss://runtime.example.test/ws/terminal",
      },
      values: { workTrackerApiKey: "browser-token" },
      serviceHealth: {
        state: "ready",
        service: "backend",
        message: null,
        logPointer: null,
      },
      initialNotices: [],
    });
  });

  it("rejects invalid browser endpoint configuration", () => {
    expect(() =>
      createBrowserRuntime({
        environment: { VITE_AGENT_API_BASE: "ftp://runtime.example.test/api" },
      }),
    ).toThrowError(
      "Invalid Studio runtime configuration: agentApi must be a relative path or an HTTP(S) URL",
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
