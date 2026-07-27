import { describe, it, expect } from "vitest";
import {
  highestAttentionState,
  presentLifecycle,
  reduceLifecycle,
  type LifecycleEventKind,
  type LifecycleState,
} from "../../features/agents/terminal/lifecycle";

describe("reduceLifecycle", () => {
  // Every recognized kind maps to its documented state, regardless of where
  // the session currently sits — the transition is a pure function of the kind.
  const cases: Array<[LifecycleEventKind, LifecycleState]> = [
    ["session_start", "starting"],
    ["turn_start", "working"],
    ["tool_use", "working"],
    ["awaiting_input", "needs_input"],
    ["permission_required", "permission_required"],
    ["turn_complete", "turn_complete"],
    ["idle", "quiet"],
    ["error", "error"],
    ["session_end", "exited"],
  ];

  it.each(cases)("maps kind %s to state %s", (kind, expected) => {
    expect(reduceLifecycle("unknown", kind)).toBe(expected);
  });

  it("ignores an unrecognized kind, keeping the current state", () => {
    const bogus = "garbage" as LifecycleEventKind;
    expect(reduceLifecycle("working", bogus)).toBe("working");
  });

  it("overwrites the prior state on a recognized transition", () => {
    // needs_input → working when the agent resumes after an answer.
    expect(reduceLifecycle("needs_input", "turn_start")).toBe("working");
    // working → needs_input when the agent asks a question mid-turn.
    expect(reduceLifecycle("working", "awaiting_input")).toBe("needs_input");
  });

  it("is idempotent for a repeated event of the same kind", () => {
    const once = reduceLifecycle("unknown", "turn_complete");
    expect(reduceLifecycle(once, "turn_complete")).toBe("turn_complete");
  });
});

describe("presentLifecycle (#504)", () => {
  it("flags only needs_input, turn_complete, and error as attention states", () => {
    const attention: LifecycleState[] = ["needs_input", "turn_complete", "error"];
    const calm: LifecycleState[] = [
      "starting",
      "working",
      "permission_required",
      "quiet",
      "reconnecting",
      "exited",
      "unknown",
    ];
    for (const s of attention) expect(presentLifecycle(s).needsAttention).toBe(true);
    for (const s of calm) expect(presentLifecycle(s).needsAttention).toBe(false);
  });

  it("ranks attention states above working and quiet", () => {
    const p = (s: LifecycleState) => presentLifecycle(s).priority;
    expect(p("error")).toBeGreaterThan(p("needs_input"));
    expect(p("needs_input")).toBeGreaterThan(p("turn_complete"));
    expect(p("turn_complete")).toBeGreaterThan(p("working"));
    expect(p("working")).toBeGreaterThan(p("quiet"));
  });

  it("labels quiet honestly as a heuristic, not a confirmed completion", () => {
    const p = presentLifecycle("quiet");
    expect(p.label).toBe("Quiet");
    expect(p.title.toLowerCase()).toContain("heuristic");
    // Must not read as a confirmed finish like turn_complete's "Done".
    expect(p.label).not.toBe("Done");
  });

  it("presents permission review without claiming human attention", () => {
    const presentation = presentLifecycle("permission_required");
    expect(presentation.label).toBe("Permission required");
    expect(presentation.needsAttention).toBe(false);
  });

  it("renders nothing for the unknown state (blank label)", () => {
    expect(presentLifecycle("unknown").label).toBe("");
  });
});

describe("highestAttentionState (#504)", () => {
  it("returns null when no session needs attention", () => {
    expect(highestAttentionState(["working", "quiet", "exited"])).toBeNull();
    expect(highestAttentionState([])).toBeNull();
  });

  it("picks the most attention-worthy state among many", () => {
    expect(
      highestAttentionState(["working", "needs_input", "quiet"]),
    ).toBe("needs_input");
    // error outranks needs_input.
    expect(
      highestAttentionState(["needs_input", "error", "turn_complete"]),
    ).toBe("error");
    // turn_complete still surfaces over plain working.
    expect(highestAttentionState(["working", "turn_complete"])).toBe(
      "turn_complete",
    );
  });
});
