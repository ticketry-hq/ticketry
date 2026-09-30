import { describe, expect, it } from "vitest";

import { developmentProxy } from "../../../vite.proxy";

describe("developmentProxy", () => {
  it("routes HTTP traffic to the selected instance backend", () => {
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(proxy["/graphql/subscribe"].target).toBe("http://127.0.0.1:43210");
    expect(proxy["/graphql"].target).toBe("http://127.0.0.1:43210");
    expect(proxy["/documents"].target).toBe("http://127.0.0.1:43210");
    expect(proxy["/graphql"].changeOrigin).toBe(false);
  });

  it("keeps streaming subscriptions on HTTP instead of a WebSocket", () => {
    // The subscription route is a streaming HTTP response.
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(proxy["/graphql/subscribe"].ws).toBeUndefined();
    expect(proxy["/graphql"].ws).toBeUndefined();
  });

  it("forwards the terminal attach socket with WebSocket upgrades", () => {
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(proxy["/ws/terminal"]).toEqual({
      target: "http://127.0.0.1:43210",
      changeOrigin: false,
      ws: true,
    });
    // Only the intended PTY WebSocket route carries the upgrade flag.
    expect(Object.keys(proxy)).toEqual([
      "/graphql/subscribe",
      "/graphql",
      "/documents",
      "/ws/terminal",
    ]);
  });
});
