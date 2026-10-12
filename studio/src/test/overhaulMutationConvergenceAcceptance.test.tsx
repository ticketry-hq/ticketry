import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkItem,
  deleteWorkItem,
  reorderWorkItem,
  reparentWorkItem,
  transitionWorkItem,
} from "../features/work-items/mutationTransport";
import { ApiError } from "../shared/api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../shared/apollo/client";
import { mutationFailurePhase } from "../shared/apollo/declaredMutation";
import { installScriptedGraphQlTransport } from "./scriptedGraphQlTransport";
import {
  cachedIssue,
  cachedModuleIds,
  issueRow,
  moduleOpenData,
  seedModule,
  WorkTrackerModuleOpenDocument,
} from "./workItemCacheFixtures";

// User-visible convergence guarantees of declared work-item writes. Each case
// calls a public work-item write entry point under the real Studio Apollo
// client and observes only the GraphQL requests that reached the scripted
// transport, what the cache returns for the affected module lists, and the
// rejection callers receive.

afterEach(async () => {
  vi.restoreAllMocks();
  await resetStudioApolloClient();
});

function moduleRead(moduleId: string) {
  return { operationName: "WorkTrackerModuleOpen", variables: { moduleId } };
}

function moduleRows(moduleId: string, optimistic = false) {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    optimistic,
  })?.work_items.nodes;
}

describe("[overhaul-467] declared mutation convergence acceptance", () => {
  it("moves an item across modules and refreshes source and returned destination once each", async () => {
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
      parent_id: "story-b",
      state_revision: 2,
      updated_at: "2026-10-03T00:00:00Z",
    });
    transport
      .answer("ReparentWorkTrackerWorkItem", { update_work_item: moved })
      .answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
        moduleOpenData(moduleId === "module-a" ? [sourceSibling] : [destinationSibling, moved]));

    // The caller names the destination too; it is still read only once.
    await expect(reparentWorkItem("item-1", "story-b", {
      moduleId: "module-a",
      moduleIds: ["module-b"],
    })).resolves.toMatchObject({ id: "item-1" });

    expect(transport.requests).toEqual([
      { operationName: "ReparentWorkTrackerWorkItem", variables: { id: "item-1", parentId: "story-b" } },
      moduleRead("module-a"),
      moduleRead("module-b"),
    ]);
    expect(cachedModuleIds("module-a")).toEqual(["source-sibling"]);
    expect(cachedModuleIds("module-b")).toEqual(["destination-sibling", "item-1"]);
    expect(cachedIssue("item-1")).toMatchObject({ module_id: "module-b", parent_id: "story-b" });
  });

  it("leaves a module list no component is watching holding the server's rows", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { state_id: "state-1" }), issueRow("removed-elsewhere")]);
    const transitioned = issueRow("item-1", { state_id: "state-ready", state_revision: 2 });
    transport
      .answer("TransitionWorkTrackerWorkItem", { update_work_item: transitioned })
      .answer("WorkTrackerModuleOpen", moduleOpenData([transitioned, issueRow("added-elsewhere")]));
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await transitionWorkItem("item-1", "state-ready", { moduleId: "module-1" });

    expect(transport.requests).toEqual([
      {
        operationName: "TransitionWorkTrackerWorkItem",
        variables: { id: "item-1", targetStateId: "state-ready" },
      },
      moduleRead("module-1"),
    ]);
    expect(moduleRows("module-1")?.map((row) => [row.id, row.state_id])).toEqual([
      ["item-1", "state-ready"],
      ["added-elsewhere", "state-1"],
    ]);
  });

  it("creates an item once, in its exact module list, after the optimistic row resolves", async () => {
    const transport = installScriptedGraphQlTransport();
    const existing = issueRow("item-1");
    const created = issueRow("item-2", { name: "New", updated_at: "2026-10-02T00:00:00Z" });
    const elsewhere = issueRow("elsewhere", { module_id: "module-2", parent_id: "module-2" });
    seedModule("module-1", [existing]);
    seedModule("module-2", [elsewhere]);
    const write = transport.holdNext("CreateWorkTrackerWorkItem");
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([existing, created]));

    const pending = createWorkItem(
      "project-1",
      { name: "New", issue_type_id: "type-1" },
      { moduleId: "module-1", optimistic: issueRow("optimistic:1", { name: "New", rank: "b" }) },
    );
    await write.reached;
    expect(moduleRows("module-1", true)?.map((row) => row.id)).toEqual(["item-1", "optimistic:1"]);

    write.answer({ create_work_item: created });
    await expect(pending).resolves.toMatchObject({ id: "item-2", name: "New" });

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerWorkItem",
        variables: { projectId: "project-1", name: "New", issueTypeId: "type-1" },
      },
      moduleRead("module-1"),
    ]);
    expect(moduleRows("module-1", true)?.map((row) => row.id)).toEqual(["item-1", "item-2"]);
    expect(cachedModuleIds("module-1")).toEqual(["item-1", "item-2"]);
    expect(cachedModuleIds("module-2")).toEqual(["elsewhere"]);
    expect(cachedIssue("optimistic:1", true)).toBeNull();
  });

  it("evicts a deleted item's compacted identity and keeps it gone after refresh", async () => {
    const transport = installScriptedGraphQlTransport();
    const doomedId = "0123456789abcdef0123456789abcdef";
    const doomedPublicId = "01234567-89ab-cdef-0123-456789abcdef";
    const keep = issueRow("keep");
    const other = issueRow("other", { module_id: "module-2", parent_id: "module-2" });
    seedModule("module-1", [keep, issueRow(doomedId)]);
    seedModule("module-2", [other, issueRow(doomedId)]);
    transport
      .answer("DeleteWorkTrackerWorkItem", { delete_work_item: true })
      .answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
        moduleOpenData(moduleId === "module-1" ? [keep] : [other]));

    await expect(deleteWorkItem(doomedPublicId, {
      moduleId: "module-1",
      moduleIds: ["module-2"],
    })).resolves.toBeUndefined();

    expect(transport.requests).toEqual([
      { operationName: "DeleteWorkTrackerWorkItem", variables: { id: doomedId } },
      moduleRead("module-1"),
      moduleRead("module-2"),
    ]);
    expect(cachedIssue(doomedId)).toBeNull();
    expect(cachedIssue(doomedId, true)).toBeNull();
    expect(cachedModuleIds("module-1")).toEqual(["keep"]);
    expect(cachedModuleIds("module-2")).toEqual(["other"]);

    // A later read of the same list does not bring the deleted row back.
    await studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
      fetchPolicy: "network-only",
    });
    expect(cachedIssue(doomedId)).toBeNull();
    expect(cachedModuleIds("module-1")).toEqual(["keep"]);
  });

  it("settles every sibling rank in the exact module list after a rebalancing reorder", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", { rank: "a" }),
      issueRow("item-2", { rank: "c" }),
      issueRow("item-3", { rank: "e" }),
    ]);
    const moved = issueRow("item-3", { rank: "U", state_revision: 2 });
    transport
      .answer("ReorderWorkTrackerWorkItem", { reorder_work_item: moved })
      .answer("WorkTrackerModuleOpen", moduleOpenData([
        issueRow("item-1", { rank: "M" }),
        moved,
        issueRow("item-2", { rank: "g" }),
      ]));
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(reorderWorkItem(
      "item-3",
      { before_id: "item-1", after_id: "item-2" },
      { moduleId: "module-1" },
    )).resolves.toMatchObject({ id: "item-3", rank: "U" });

    expect(transport.requests).toEqual([
      {
        operationName: "ReorderWorkTrackerWorkItem",
        variables: { id: "item-3", beforeId: "item-1", afterId: "item-2" },
      },
      moduleRead("module-1"),
    ]);
    expect(moduleRows("module-1")?.map((row) => [row.id, row.rank])).toEqual([
      ["item-1", "M"],
      ["item-3", "U"],
      ["item-2", "g"],
    ]);
    expect(cachedIssue("item-2")).toMatchObject({ rank: "g" });
  });

  it("keeps a saved write when its refresh fails, reports the refresh phase and never re-sends it", async () => {
    const transport = installScriptedGraphQlTransport();
    const destinationSibling = issueRow("destination-sibling", {
      module_id: "module-b",
      parent_id: "module-b",
    });
    seedModule("module-a", [issueRow("item-1", { module_id: "module-a", parent_id: "module-a" })]);
    const moved = issueRow("item-1", {
      module_id: "module-b",
      parent_id: "story-b",
      state_revision: 2,
    });
    transport
      .answer("ReparentWorkTrackerWorkItem", { update_work_item: moved })
      .failNext("WorkTrackerModuleOpen", "worktracker_read_unavailable", "Read unavailable")
      .answer("WorkTrackerModuleOpen", moduleOpenData([destinationSibling, moved]));

    const failure = await reparentWorkItem("item-1", "story-b", { moduleId: "module-a" })
      .catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      body: { code: "worktracker_read_unavailable", detail: "Read unavailable" },
    });
    expect(mutationFailurePhase(failure)).toBe("refresh");
    expect(transport.requests).toEqual([
      { operationName: "ReparentWorkTrackerWorkItem", variables: { id: "item-1", parentId: "story-b" } },
      moduleRead("module-a"),
      moduleRead("module-b"),
    ]);
    expect(cachedIssue("item-1")).toMatchObject({
      module_id: "module-b",
      parent_id: "story-b",
      state_revision: 2,
    });
    // The other list's refresh still lands; the failed one is not retried.
    expect(cachedModuleIds("module-b")).toEqual(["destination-sibling", "item-1"]);
  });
});
