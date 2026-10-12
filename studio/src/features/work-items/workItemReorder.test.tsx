import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../shared/api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { mutationFailurePhase } from "../../shared/apollo/declaredMutation";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  cachedIssue,
  issueRow,
  moduleOpenData,
  seedModule,
  WorkTrackerModuleOpenDocument,
} from "../../test/workItemCacheFixtures";
import { useReorderWorkItem } from "./mutations";
import { reorderWorkItem } from "./mutationTransport";
import { consumeLocalWorkItemConvergence } from "./workItemConvergence";

afterEach(async () => {
  vi.restoreAllMocks();
  await resetStudioApolloClient();
});

const membership = { projectId: "project-1", moduleId: "module-1" };

function cachedModuleRanks(moduleId: string): [string, string][] | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
  })?.work_items.nodes.map((row) => [row.id, row.rank]);
}

function storyMoveEvents(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .filter(([tag]) => tag === "[story-move]")
    .map(([, event, details]) => [event, details]);
}

describe("work-item reorder", () => {
  it("shows the move at once, then settles every rebalanced sibling to its server rank", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", { rank: "a" }),
      issueRow("item-2", { rank: "c" }),
      issueRow("item-3", { rank: "e" }),
    ]);
    const write = transport.holdNext("ReorderWorkTrackerWorkItem");
    const moved = issueRow("item-3", {
      rank: "U",
      state_revision: 2,
      updated_at: "2026-10-04T00:00:00Z",
    });
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([
      issueRow("item-1", { rank: "M" }),
      moved,
      issueRow("item-2", { rank: "g" }),
    ]));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const mutation = renderHook(() => useReorderWorkItem(membership));

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({
        id: "item-3",
        beforeId: "item-1",
        afterId: "item-2",
      });
    });
    const request = await write.reached;
    expect(request.variables).toEqual({ id: "item-3", beforeId: "item-1", afterId: "item-2" });
    expect(cachedIssue("item-3", true)).toMatchObject({ rank: "b" });

    write.answer({ reorder_work_item: moved });
    await act(async () => {
      await pending;
    });

    expect(transport.requests).toEqual([
      request,
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
    ]);
    expect(cachedModuleRanks("module-1")).toEqual([
      ["item-1", "M"],
      ["item-3", "U"],
      ["item-2", "g"],
    ]);
    expect(storyMoveEvents(info)).toEqual([
      ["reorder-requested", {
        id: "item-3",
        beforeId: "item-1",
        afterId: "item-2",
        moduleId: "module-1",
        optimistic: true,
      }],
      ["reorder-mutation-succeeded", { id: "item-3", stateId: "state-1", rank: "U" }],
      ["reorder-refresh-succeeded", { id: "item-3", moduleId: "module-1" }],
    ]);
    expect(consumeLocalWorkItemConvergence("item-3", "2026-10-04T00:00:00Z")).toBe(true);
    expect(consumeLocalWorkItemConvergence("item-3", "2026-10-04T00:00:00Z")).toBe(false);
  });

  it("keeps a committed reorder when its module refresh fails, reports the refresh phase and never re-sends it", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", { rank: "a" }),
      issueRow("item-2", { rank: "c" }),
    ]);
    const moved = issueRow("item-2", {
      rank: "0",
      state_revision: 2,
      updated_at: "2026-10-05T00:00:00Z",
    });
    transport
      .answer("ReorderWorkTrackerWorkItem", { reorder_work_item: moved })
      .failNext("WorkTrackerModuleOpen", "worktracker_read_unavailable", "Read unavailable");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failure = await reorderWorkItem(
      "item-2",
      { before_id: null, after_id: "item-1" },
      { moduleId: "module-1" },
    ).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ body: { code: "worktracker_read_unavailable" } });
    expect(mutationFailurePhase(failure)).toBe("refresh");
    expect(transport.operationNames()).toEqual([
      "ReorderWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
    expect(cachedIssue("item-2")).toMatchObject({ rank: "0", state_revision: 2 });
    expect(storyMoveEvents(error)).toEqual([[
      "reorder-failed",
      expect.objectContaining({
        id: "item-2",
        beforeId: null,
        afterId: "item-1",
        moduleId: "module-1",
        phase: "module-refresh",
        error: expect.objectContaining({ message: "Read unavailable" }),
      }),
    ]]);
    expect(consumeLocalWorkItemConvergence("item-2", "2026-10-05T00:00:00Z")).toBe(true);
  });

  it("rolls back the optimistic rank when the write fails and sends no refresh", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", { rank: "a" }),
      issueRow("item-2", { rank: "c" }),
      issueRow("item-3", { rank: "e" }),
    ]);
    const write = transport.holdNext("ReorderWorkTrackerWorkItem");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mutation = renderHook(() => useReorderWorkItem(membership));

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({
        id: "item-3",
        beforeId: "item-1",
        afterId: "item-2",
      }).catch((failure: unknown) => failure);
    });
    await write.reached;
    expect(cachedIssue("item-3", true)).toMatchObject({ rank: "b" });
    write.fail("conflict", "Neighbours moved");
    let failure: unknown;
    await act(async () => {
      failure = await pending;
    });

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, body: { code: "conflict" } });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(cachedIssue("item-3", true)).toMatchObject({ rank: "e" });
    expect(transport.operationNames()).toEqual(["ReorderWorkTrackerWorkItem"]);
    expect(storyMoveEvents(error)).toEqual([[
      "reorder-failed",
      expect.objectContaining({
        id: "item-3",
        beforeId: "item-1",
        afterId: "item-2",
        moduleId: "module-1",
        phase: "mutation",
        error: expect.objectContaining({ message: "Neighbours moved" }),
      }),
    ]]);
  });

  it("skips only the optimistic move between duplicate neighbour ranks and still sends the reorder", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", { rank: "a" }),
      issueRow("item-2", { rank: "a" }),
      issueRow("item-3", { rank: "e" }),
    ]);
    const write = transport.holdNext("ReorderWorkTrackerWorkItem");
    const repaired = issueRow("item-3", { rank: "b", state_revision: 2 });
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([
      issueRow("item-1", { rank: "M" }),
      repaired,
      issueRow("item-2", { rank: "g" }),
    ]));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const mutation = renderHook(() => useReorderWorkItem(membership));

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({
        id: "item-3",
        beforeId: "item-1",
        afterId: "item-2",
      });
    });
    const request = await write.reached;
    expect(request.variables).toEqual({ id: "item-3", beforeId: "item-1", afterId: "item-2" });
    expect(cachedIssue("item-3", true)).toMatchObject({ rank: "e" });

    write.answer({ reorder_work_item: repaired });
    await act(async () => {
      await pending;
    });

    expect(transport.operationNames()).toEqual([
      "ReorderWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
    expect(cachedModuleRanks("module-1")).toEqual([
      ["item-1", "M"],
      ["item-3", "b"],
      ["item-2", "g"],
    ]);
  });

  it("records the optimistic-reorder failure when a neighbour has no known rank", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { rank: "a" })]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mutation = renderHook(() => useReorderWorkItem(membership));

    let failure: unknown;
    await act(async () => {
      failure = await mutation.result.current.mutateAsync({
        id: "item-1",
        beforeId: "unknown-item",
        afterId: null,
      }).catch((cause: unknown) => cause);
    });

    expect(failure).toMatchObject({
      message: "Cannot optimistically reorder without rank for unknown-item",
    });
    expect(transport.requests).toEqual([]);
    expect(storyMoveEvents(error)).toEqual([[
      "optimistic-reorder-failed",
      expect.objectContaining({
        id: "item-1",
        beforeId: "unknown-item",
        afterId: null,
        moduleId: "module-1",
      }),
    ]]);
  });
});
