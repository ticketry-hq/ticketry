import { describe, expect, it } from "vitest";

import {
  buildAttachInit,
  buildResize,
  buildScroll,
  parseError,
  parseReady,
} from "../shared/api/transport/wireContract";

describe("terminal wire contract", () => {
  it("builds the canonical attach init, resize, and scroll frames", () => {
    expect(buildAttachInit("run-1", 120, 40)).toEqual({
      type: "init",
      mode: "attach",
      agent_run_id: "run-1",
      cols: 120,
      rows: 40,
    });
    expect(buildResize(80, 24)).toEqual({ type: "resize", cols: 80, rows: 24 });
    expect(buildScroll("up", 5)).toEqual({ type: "scroll", dir: "up", lines: 5 });
    expect(buildScroll("down", 1)).toEqual({ type: "scroll", dir: "down", lines: 1 });
  });

  it("parses ready frames and keeps a missing run id nullable", () => {
    expect(parseReady({ type: "ready", session_id: "srv-9" })).toEqual({
      type: "ready",
      session_id: "srv-9",
      agent_run_id: null,
    });
    expect(
      parseReady({ type: "ready", session_id: "srv-9", agent_run_id: "run-1" }),
    ).toEqual({ type: "ready", session_id: "srv-9", agent_run_id: "run-1" });
  });

  it("rejects malformed ready frames instead of trusting them", () => {
    expect(parseReady(null)).toBeNull();
    expect(parseReady("ready")).toBeNull();
    expect(parseReady({ type: "error", message: "x" })).toBeNull();
    expect(parseReady({ type: "ready", session_id: "" })).toBeNull();
    expect(parseReady({ type: "ready" })).toBeNull();
  });

  it("parses error frames and defaults a missing message", () => {
    expect(parseError({ type: "error", message: "session_not_found" })).toEqual({
      type: "error",
      message: "session_not_found",
    });
    expect(parseError({ type: "error" })).toEqual({
      type: "error",
      message: "ws_error",
    });
    expect(parseError({ type: "ready", session_id: "srv-9" })).toBeNull();
  });
});
