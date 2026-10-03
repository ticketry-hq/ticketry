import { describe, expect, it } from "vitest";
import { deriveAgentState } from "./agentState";

describe("sprint suggestion agent state", () => {
  it("is idle before a persisted execution exists", () => {
    expect(deriveAgentState(null, "2026-10-04T01:00:00Z", 2)).toEqual({ kind: "idle" });
  });

  it.each(["queued", "running"])("keeps a %s execution cancellable even after goals change", (state) => {
    expect(deriveAgentState({ state, goalsRevision: "revision-1", error: null }, "revision-2", 3)).toEqual({ kind: "running" });
  });

  it.each([
    ["succeeded", null, { kind: "done", waitingCount: 3 }],
    ["failed", "Provider unavailable", { kind: "error", message: "Provider unavailable" }],
    ["failed", null, { kind: "error", message: "The agent couldn’t finish." }],
    ["cancelled", null, { kind: "cancelled" }],
    ["unexpected", null, { kind: "error", message: "Unknown suggestion execution state: unexpected" }],
  ])("derives persisted %s without any live feed", (state, error, expected) => {
    expect(deriveAgentState({ state, error, goalsRevision: "revision-1" }, "revision-1", 3)).toEqual(expected);
  });

  it.each(["succeeded", "failed"])("marks a terminal %s execution stale after goal edits or deletion", (state) => {
    expect(deriveAgentState({ state, error: "Old error", goalsRevision: "revision-1" }, "revision-2", 2)).toEqual({ kind: "stale" });
  });

  it("compares nullable goal revisions without inventing staleness", () => {
    expect(deriveAgentState({ state: "succeeded", error: null, goalsRevision: null }, null, 0)).toEqual({ kind: "done", waitingCount: 0 });
    expect(deriveAgentState({ state: "succeeded", error: null, goalsRevision: "revision-1" }, null, 0)).toEqual({ kind: "stale" });
  });
});
