import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRuntime } from "../../runtime/browserRuntime";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      statusFeed: true,
      nativeLifecycle: false,
      serviceSupervision: false,
      nativeTerminal: false,
      nativeFolderPicker: false,
    });
    await expect(runtime.pickFolder()).resolves.toBeNull();
  });

  it("streams and cancels GraphQL subscriptions through the Rust adapter", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const runtime = createBrowserRuntime({ environment: {} });
    const transport = runtime.statusStream();
    const received: string[] = [];

    await expect(transport?.().graphql_subscribe(
      "status_1",
      '{"query":"subscription Status { status }"}',
      (frame) => received.push(frame),
    )).resolves.toBe('{"type":"accepted"}');
    stream.enqueue(new TextEncoder().encode('data: {"type":"next",'));
    stream.enqueue(new TextEncoder().encode('"payload":{"data":{"status":1}}}\n\n'));
    await vi.waitFor(() => expect(received).toEqual([
      '{"type":"next","payload":{"data":{"status":1}}}',
    ]));

    await expect(transport?.().graphql_unsubscribe("status_1")).resolves.toBe(true);
    await expect(transport?.().graphql_unsubscribe("status_1")).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/graphql/subscribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          subscriptionId: "status_1",
          request: '{"query":"subscription Status { status }"}',
        }),
      }),
    );
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

  it("derives the terminal WebSocket from the default same-origin endpoint", () => {
    const runtime = createBrowserRuntime({ environment: {} });

    expect(runtime.terminalWebSocketUrl?.()).toBe("/ws/terminal");
  });

  it("maps absolute GraphQL origins onto the terminal WebSocket", () => {
    const httpRuntime = createBrowserRuntime({
      environment: { VITE_GRAPHQL_API: "http://127.0.0.1:8790/graphql" },
    });
    const httpsRuntime = createBrowserRuntime({
      environment: { VITE_GRAPHQL_API: "https://host.example/graphql" },
    });

    expect(httpRuntime.terminalWebSocketUrl?.()).toBe("ws://127.0.0.1:8790/ws/terminal");
    expect(httpsRuntime.terminalWebSocketUrl?.()).toBe("wss://host.example/ws/terminal");
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
