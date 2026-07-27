import { describe, expect, it } from "vitest";

import { developmentProxy } from "../../../vite.proxy";

describe("developmentProxy", () => {
  it("routes HTTP and WebSocket traffic to the selected instance backend", () => {
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(proxy["/api"].target).toBe("http://127.0.0.1:43210");
    expect(proxy["/ws"].target).toBe("ws://127.0.0.1:43210");
    expect(proxy["/api"].changeOrigin).toBe(false);
    expect(proxy["/ws"].changeOrigin).toBe(false);
  });
});
