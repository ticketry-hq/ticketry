import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../shared/api/errors";
import type { State } from "../../shared/api/types";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { mutationFailurePhase } from "../../shared/apollo/declaredMutation";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  cachedIssue,
  cachedModuleIds,
  issueRow,
  moduleOpenData,
  seedModule,
  WorkTrackerModuleOpenDocument,
} from "../../test/workItemCacheFixtures";
import {
  useSetWorkItemBlockers,
  useSetWorkItemParent,
  useSetWorkItemState,
} from "./mutations";
import { transitionWorkItem } from "./mutationTransport";
import { consumeLocalWorkItemConvergence } from "./workItemConvergence";

afterEach(async () => {
  vi.restoreAllMocks();
  await resetStudioApolloClient();
});

const ready: State & { id: string } = {
  id: "state-ready",
  name: "Ready",
  group: "unstarted",
  color: "#999999",
  sort_order: 1,
  is_protected: false,
} as State & { id: string };

function storyMoveEvents(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .filter(([tag]) => tag === "[story-move]")
    .map(([, event, details]) => [event, details]);
}

describe("work-item reparent", () => {
  it("refreshes the source module and the returned destination module once each", async () => {
    const transport = installScriptedGraphQlTransport();
    const sourceSibling = issueRow("source-sibling", { module_id: "module-a", parent_id: "module-a" });
    const destinationSibling = issueRow("destination-sibling", {
      module_id: "module-b",
      parent_id: "module-b",
    });
    seedModule("module-a", [
      issueRow("item-1", { module_id: "module-a", parent_id: "module-a" }),
      sourceSibling,
    ]);
    seedModule("module-b", [destinationSibling]);
    const moved = issueRow("item-1", {
      module_id: "module-b",
      parent_id: "parent-b",
      state_revision: 2,
      updated_at: "2026-10-03T00:00:00Z",
    });
    transport
      .answer("ReparentWorkTrackerWorkItem", { update_work_item: moved })
      .answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
        moduleOpenData(moduleId === "module-a" ? [sourceSibling] : [destinationSibling, moved]));
    const mutation = renderHook(() =>
      useSetWorkItemParent([{ projectId: "project-1", moduleId: "module-a" }]));

    await act(async () => {
      await expect(mutation.result.current.mutateAsync({
        id: "item-1",
        parentId: "parent-b",
        moduleId: "module-a",
      })).resolves.toMatchObject({ id: "item-1" });
    });

    expect(transport.requests).toEqual([
      {
        operationName: "ReparentWorkTrackerWorkItem",
        variables: { id: "item-1", parentId: "parent-b" },
      },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-a" } },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-b" } },
    ]);
    expect(cachedModuleIds("module-a")).toEqual(["source-sibling"]);
    expect(cachedModuleIds("module-b")).toEqual(["destination-sibling", "item-1"]);
    expect(cachedIssue("item-1")).toMatchObject({ parent_id: "parent-b", module_id: "module-b" });
    expect(consumeLocalWorkItemConvergence("item-1", "2026-10-03T00:00:00Z")).toBe(true);
  });

  it("sends a new post-write module read and keeps post-write membership when the held pre-write read lands last", async () => {
    const transport = installScriptedGraphQlTransport();
    const before = issueRow("item-1", { module_id: "module-1", parent_id: "module-1" });
    const sibling = issueRow("sibling", { module_id: "module-1", parent_id: "module-1" });
    const moved = issueRow("item-1", {
      module_id: "module-2",
      parent_id: "story-2",
      state_revision: 2,
    });
    seedModule("module-1", [before, sibling]);
    const held = transport.holdNext("WorkTrackerModuleOpen");
    transport
      .answer("ReparentWorkTrackerWorkItem", { update_work_item: moved })
      .answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
        moduleOpenData(moduleId === "module-1" ? [sibling] : [moved]));
    const preWriteRead = studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
      fetchPolicy: "network-only",
    });
    await held.reached;
    const mutation = renderHook(() =>
      useSetWorkItemParent([{ projectId: "project-1", moduleId: "module-1" }]));

    await act(async () => {
      await mutation.result.current.mutateAsync({ id: "item-1", parentId: "story-2" });
    });

    expect(transport.requests).toEqual([
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
      {
        operationName: "ReparentWorkTrackerWorkItem",
        variables: { id: "item-1", parentId: "story-2" },
      },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-2" } },
    ]);
    held.answer(moduleOpenData([before, sibling]));
    await preWriteRead.catch(() => undefined);

    expect(cachedModuleIds("module-1")).toEqual(["sibling"]);
    expect(cachedModuleIds("module-2")).toEqual(["item-1"]);
    expect(cachedIssue("item-1")).toMatchObject({
      module_id: "module-2",
      parent_id: "story-2",
      state_revision: 2,
    });
  });
});

describe("work-item transition", () => {
  it("keeps the newer revision when an older transition response arrives last", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { state_id: "state-1", state_revision: 1 })]);
    const newer = issueRow("item-1", { state_id: "state-done", state_revision: 3 });
    const slow = transport.holdNext("TransitionWorkTrackerWorkItem");
    transport.answerNext("TransitionWorkTrackerWorkItem", { update_work_item: newer });
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    // Neither call names a module, so no refresh can repaint the row: only the
    // issue revision guard stands between the late rev-2 response and the cache.
    const first = transitionWorkItem("item-1", "state-doing");
    await slow.reached;
    await transitionWorkItem("item-1", "state-done");
    slow.answer({
      update_work_item: issueRow("item-1", { state_id: "state-doing", state_revision: 2 }),
    });
    await first;

    expect(transport.operationNames()).toEqual([
      "TransitionWorkTrackerWorkItem",
      "TransitionWorkTrackerWorkItem",
    ]);
    expect(cachedIssue("item-1")).toMatchObject({ state_id: "state-done", state_revision: 3 });
    expect(cachedIssue("item-1", true)).toMatchObject({ state_id: "state-done", state_revision: 3 });
  });

  it("rolls back a failed transition and records the failure diagnostic", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { state_id: "state-1" })]);
    const write = transport.holdNext("TransitionWorkTrackerWorkItem");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mutation = renderHook(() => useSetWorkItemState());

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({ id: "item-1", state: ready })
        .catch((failure: unknown) => failure);
    });
    await write.reached;
    expect(cachedIssue("item-1", true)).toMatchObject({ state_id: "state-ready" });
    write.fail("illegal_transition", "Transition not allowed");
    let failure: unknown;
    await act(async () => {
      failure = await pending;
    });

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, body: { code: "illegal_transition" } });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(cachedIssue("item-1", true)).toMatchObject({ state_id: "state-1" });
    expect(transport.operationNames()).toEqual(["TransitionWorkTrackerWorkItem"]);
    expect(storyMoveEvents(info)).toEqual([[
      "transition-requested",
      { id: "item-1", targetStateId: "state-ready", optimistic: true },
    ]]);
    expect(storyMoveEvents(error)).toEqual([[
      "transition-failed",
      expect.objectContaining({
        id: "item-1",
        targetStateId: "state-ready",
        error: expect.objectContaining({ message: "Transition not allowed" }),
      }),
    ]]);
  });

  it("keeps a committed transition when its module refresh fails and never re-sends it", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { state_id: "state-1" })]);
    const moved = issueRow("item-1", { state_id: "state-ready", state_revision: 2 });
    transport
      .answer("TransitionWorkTrackerWorkItem", { update_work_item: moved })
      .failNext("WorkTrackerModuleOpen", "worktracker_read_unavailable", "Read unavailable");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failure = await transitionWorkItem("item-1", "state-ready", { moduleId: "module-1" })
      .catch((cause: unknown) => cause);

    expect(mutationFailurePhase(failure)).toBe("refresh");
    expect(failure).toMatchObject({ body: { code: "worktracker_read_unavailable" } });
    expect(transport.operationNames()).toEqual([
      "TransitionWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
    expect(cachedIssue("item-1")).toMatchObject({ state_id: "state-ready", state_revision: 2 });
    expect(storyMoveEvents(error)).toEqual([[
      "transition-failed",
      expect.objectContaining({ id: "item-1", targetStateId: "state-ready" }),
    ]]);
  });

  it("records success and refreshes the item's module once the transition commits", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { state_id: "state-1" })]);
    const moved = issueRow("item-1", { state_id: "state-ready", rank: "b", state_revision: 2 });
    transport
      .answer("TransitionWorkTrackerWorkItem", { update_work_item: moved })
      .answer("WorkTrackerModuleOpen", moduleOpenData([moved]));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const mutation = renderHook(() => useSetWorkItemState());

    await act(async () => {
      await mutation.result.current.mutateAsync({ id: "item-1", state: ready });
    });

    expect(transport.requests).toEqual([
      {
        operationName: "TransitionWorkTrackerWorkItem",
        variables: { id: "item-1", targetStateId: "state-ready" },
      },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
    ]);
    expect(storyMoveEvents(info)).toEqual([
      ["transition-requested", { id: "item-1", targetStateId: "state-ready", optimistic: true }],
      ["transition-succeeded", { id: "item-1", stateId: "state-ready", rank: "b" }],
    ]);
    expect(cachedIssue("item-1")).toMatchObject({ state_id: "state-ready", state_revision: 2 });
  });
});

describe("work-item blockers", () => {
  it("shows synthetic blocker edges while pending, then refreshes the item's module", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1"), issueRow("item-2")]);
    const write = transport.holdNext("SetWorkTrackerBlockers");
    const blocked = issueRow("item-1", {
      state_revision: 2,
      blocked_by_edges: {
        __typename: "WorktrackerIssueDependencyConnection",
        nodes: [{ __typename: "WorktrackerIssueBlockedBy", id: 7, to_issue_id: "item-2" }],
      },
    } as never);
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([blocked, issueRow("item-2")]));
    const mutation = renderHook(() => useSetWorkItemBlockers());

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({ id: "item-1", blockedByIds: ["item-2"] });
    });
    const request = await write.reached;
    expect(request.variables).toEqual({ id: "item-1", blockedByIds: ["item-2"] });
    const optimisticEdges = cachedIssue("item-1", true)?.blocked_by_edges.nodes;
    expect(optimisticEdges).toHaveLength(1);
    expect(optimisticEdges?.[0]).toMatchObject({ to_issue_id: "item-2" });
    expect(optimisticEdges?.[0]?.id).toBeLessThan(0);

    write.answer({ update_work_item: blocked });
    await act(async () => {
      await pending;
    });

    expect(transport.operationNames()).toEqual(["SetWorkTrackerBlockers", "WorkTrackerModuleOpen"]);
    expect(transport.requests[1]?.variables).toEqual({ moduleId: "module-1" });
    expect(cachedIssue("item-1")?.blocked_by_edges.nodes).toEqual([
      expect.objectContaining({ id: 7, to_issue_id: "item-2" }),
    ]);
  });
});
