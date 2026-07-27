// #872 — the workflow gate's structured rejection must reach the user on a
// failed move. The backend (#860) answers an illegal state change with a 422
// body carrying a human `detail` (+ machine `code`/`from`/`to`); the FE must
// surface that `detail` on the three write doors — board drag, status change,
// and the bulk fan-out — not a bare "422".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>("../shared/api/client");
  return { ...actual, patchWorkItem: vi.fn() };
});
import * as api from "../shared/api/client";
import { ApiError, apiErrorMessage } from "../shared/api/client";
import { useBacklogStore } from "../features/work-items/internal/backlogStore";
import { useToastStore } from "../app/stores/toastStore";
import type { State, WorkItem } from "../shared/api/types";

const patchWorkItem = api.patchWorkItem as ReturnType<typeof vi.fn>;

const IDEA: State = { id: "st-idea", name: "Idea", group: "backlog", color: null };
const DONE: State = { id: "st-done", name: "Done", group: "completed", color: null };

// The exact structured 422 the sole-writer emits for an illegal Story move.
const GATE_DETAIL = "A Story cannot move 'Idea' → 'Done'.";
const gateError = () =>
  new ApiError(422, "Unprocessable Entity", {
    detail: GATE_DETAIL,
    code: "illegal_transition",
    from: "Idea",
    to: "Done",
  });

function wi(partial: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    name: partial.id,
    project_id: "p1",
    sequence_id: 1,
    state: null,
    assignees: [],
    labels: [],
    description_html: null,
    description_stripped: null,
    description: null,
    parent_id: null,
    sub_issues_count: 0,
    blocked_by_ids: [],
    blocks_ids: [],
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    key: `MEML-${partial.id}`,
    ...partial,
  };
}

const store = () => useBacklogStore.getState();
const errorToasts = () =>
  useToastStore.getState().toasts.filter((t) => t.kind === "error").map((t) => t.message);

beforeEach(() => {
  patchWorkItem.mockReset();
  useBacklogStore.setState({ items: [], states: [IDEA, DONE], error: null });
  useToastStore.setState({ toasts: [] });
});

describe("apiErrorMessage (#872)", () => {
  it("prefers the gate's human detail over the status line", () => {
    expect(apiErrorMessage(gateError())).toBe(GATE_DETAIL);
  });

  it("falls back to status:message for an API error without a detail body", () => {
    expect(apiErrorMessage(new ApiError(409, "conflict", {}))).toBe("409: conflict");
  });

  it("falls back to the raw message for a non-API error", () => {
    expect(apiErrorMessage(new Error("network down"))).toBe("network down");
  });
});

describe("rejection surfaced on every write door (#872)", () => {
  it("status change (setItemState) toasts the structured reason and rolls back", async () => {
    useBacklogStore.setState({ items: [wi({ id: "a", state: IDEA })] });
    patchWorkItem.mockRejectedValue(gateError());

    await store().setItemState("a", "st-done");

    expect(errorToasts()).toContain(GATE_DETAIL);
    expect(store().items[0].state?.id).toBe("st-idea"); // rolled back
    expect(store().error).toBe(GATE_DETAIL);
  });

  it("bulk action (bulkSetState) toasts one reason for the fanned-out rejection", async () => {
    useBacklogStore.setState({
      items: [wi({ id: "a", state: IDEA }), wi({ id: "b", state: IDEA })],
    });
    patchWorkItem.mockRejectedValue(gateError());

    const r = await store().bulkSetState(["a", "b"], "st-done");

    expect(r).toEqual({ ok: 0, failed: 2 });
    // Identical reason across the fan-out → a single de-duplicated toast.
    expect(errorToasts()).toEqual([GATE_DETAIL]);
    expect(store().items.every((i) => i.state?.id === "st-idea")).toBe(true); // rolled back
  });
});
