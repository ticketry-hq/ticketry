import { describe, expect, it } from "vitest";

import { EMPTY_FEEDBACK, liveFeedback, moveFeedback, observed, type Move, type MoveFeedback } from "./moveFeedback";

const move = (itemId: string, from: string | null, to: string | null): Move => ({ itemId, key: itemId, from, to });
const run = (...steps: Parameters<typeof moveFeedback>[1][]) => steps.reduce(moveFeedback, EMPTY_FEEDBACK);

describe("moveFeedback", () => {
  it("offers Undo after success and Retry after failure", () => {
    const a = move("a", null, "s");
    const done = run({ type: "start", op: 1, move: a }, { type: "settle", op: 1, ok: true });
    expect(done.pending).toEqual({});
    expect(done.success).toEqual({ op: 1, move: a });
    const failed = run({ type: "start", op: 1, move: a }, { type: "settle", op: 1, ok: false });
    expect(failed.failures).toEqual([{ op: 1, move: a }]);
    expect(failed.success).toBeNull();
  });

  it("keeps several failures independently", () => {
    const state = run(
      { type: "start", op: 1, move: move("a", null, "s") },
      { type: "start", op: 2, move: move("b", null, "s") },
      { type: "settle", op: 2, ok: false },
      { type: "settle", op: 1, ok: false },
      { type: "dismiss", itemId: "b" },
    );
    expect(state.failures.map((failure) => failure.move.itemId)).toEqual(["a"]);
  });

  it("lets an older completion never replace newer success", () => {
    const state = run(
      { type: "start", op: 1, move: move("a", null, "s") },
      { type: "start", op: 2, move: move("b", null, "s") },
      { type: "settle", op: 2, ok: true },
      { type: "settle", op: 1, ok: true },
    );
    expect(state.success?.move.itemId).toBe("b");
  });

  it("supersedes an item's Retry and Undo when it moves again", () => {
    const failed = run({ type: "start", op: 1, move: move("a", null, "s") }, { type: "settle", op: 1, ok: false });
    expect(moveFeedback(failed, { type: "start", op: 2, move: move("a", null, "s") }).failures).toEqual([]);
    const done = run({ type: "start", op: 1, move: move("a", null, "s") }, { type: "settle", op: 1, ok: true });
    expect(moveFeedback(done, { type: "start", op: 2, move: move("a", "s", null) }).success).toBeNull();
    // Another item's move leaves the Undo until it succeeds.
    expect(moveFeedback(done, { type: "start", op: 2, move: move("b", null, "s") }).success?.op).toBe(1);
  });

  it("ignores settlements for unknown ops and expiry of a replaced toast", () => {
    const done = run({ type: "start", op: 1, move: move("a", null, "s") }, { type: "settle", op: 1, ok: true });
    expect(moveFeedback(done, { type: "settle", op: 9, ok: false })).toBe(done);
    expect(moveFeedback(done, { type: "expire", op: 0 })).toBe(done);
    expect(moveFeedback(done, { type: "expire", op: 1 }).success).toBeNull();
  });

  it("hides Retry and Undo once the assignment no longer matches", () => {
    const state = run(
      { type: "start", op: 1, move: move("a", null, "s") },
      { type: "settle", op: 1, ok: false },
      { type: "start", op: 2, move: move("b", null, "s") },
      { type: "settle", op: 2, ok: true },
    );
    const assigned = new Map<string, string | null>([["a", null], ["b", "s"]]);
    expect(liveFeedback(state, (id) => assigned.get(id))).toEqual(state);
    const moved = new Map<string, string | null>([["a", "s"], ["b", null]]);
    expect(liveFeedback(state, (id) => moved.get(id))).toEqual({ ...state, failures: [], success: null });
    expect(liveFeedback(state, () => undefined).failures).toEqual([]);
  });

  it("keeps an overtaken Retry and Undo gone after the item returns", () => {
    const state = run(
      { type: "start", op: 1, move: move("a", null, "s") },
      { type: "settle", op: 1, ok: false },
      { type: "start", op: 2, move: move("b", null, "s") },
      { type: "settle", op: 2, ok: true },
      { type: "start", op: 3, move: move("c", null, "s") },
      { type: "settle", op: 3, ok: false },
    );
    const observe = (state: MoveFeedback, at: Record<string, string | null>) => {
      const event = observed(state, (id) => at[id]);
      return event ? moveFeedback(state, event) : state;
    };
    // A failure's rollback lands after it settles: still at "s" is not a move made elsewhere.
    const settling = observe(state, { a: "s", b: "s", c: "s" });
    expect(settling.failures.map((failure) => failure.op)).toEqual([1, 3]);
    const seen = observe(settling, { a: null, b: "s", c: null });
    expect(observed(seen, (id) => ({ a: null, b: "s", c: null })[id] ?? null)).toBeNull();
    // Moved away elsewhere, then back where each move expected: a and b stay gone, c is independent.
    const back = observe(observe(seen, { a: "s", b: null, c: null }), { a: null, b: "s", c: null });
    expect(back.failures.map((failure) => failure.op)).toEqual([3]);
    expect(back.success).toBeNull();
  });
});

describe("moveFeedback reset", () => {
  it("drops Undo, Retry and pending, and ignores a late settle of an old op", () => {
    const state = run(
      { type: "start", op: 1, move: move("a", null, "s") },
      { type: "settle", op: 1, ok: true },
      { type: "start", op: 2, move: move("b", null, "s") },
      { type: "settle", op: 2, ok: false },
      { type: "start", op: 3, move: move("c", null, "s") },
      { type: "reset" },
      { type: "settle", op: 3, ok: true },
    );
    expect(state).toEqual(EMPTY_FEEDBACK);
  });
});
