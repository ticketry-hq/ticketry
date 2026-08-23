import { describe, expect, it } from "vitest";

import { developmentProxy } from "../../../vite.proxy";

describe("developmentProxy", () => {
  it("routes HTTP traffic to the selected instance backend", () => {
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(proxy["/api"].target).toBe("http://127.0.0.1:43210");
    expect(proxy["/api"].changeOrigin).toBe(false);
  });

  it("forwards no WebSocket traffic", () => {
    // Status is a GraphQL subscription and terminal bytes come from the Rust
    // tmux adapter, both over the desktop's in-process transport. Nothing
    // listens on `/ws`, so a forward here could only hold a browser tab open
    // against a connection that never completes.
    const proxy = developmentProxy("http://127.0.0.1:43210");

    expect(Object.keys(proxy)).toEqual(["/api"]);
    expect(proxy["/api"].ws).toBeUndefined();
  });
});
