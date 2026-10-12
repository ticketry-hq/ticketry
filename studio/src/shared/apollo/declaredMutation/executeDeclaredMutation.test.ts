import { afterEach, describe, expect, it } from "vitest";

import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
  UpdateWorkTrackerWorkItemDetailsDocument,
} from "../../../features/work-items/generated/workItems.documents";
import { installScriptedGraphQlTransport } from "../../../test/scriptedGraphQlTransport";
import {
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
  cachedIssue,
  cachedModuleIds,
  issueRow,
  moduleOpenData,
  seedModule,
  workItemData,
} from "../../../test/workItemCacheFixtures";
import { ApiError } from "../../api/errors";
import { resetStudioApolloClient, studioApolloClient } from "../client";
import {
  declareMutation,
  executeDeclaredMutation,
  mutationFailurePhase,
  refreshRead,
} from ".";

afterEach(async () => resetStudioApolloClient());

interface RenameArgs { id: string; name: string; moduleIds?: string[] }

/** A test-only declaration: one generated document plus its effects. */
function renameDeclaration(events: string[] = []) {
  return declareMutation({
    document: UpdateWorkTrackerWorkItemDetailsDocument,
    variables: ({ id, name }: RenameArgs) => ({ id, name }),
    root: "update_work_item",
    optimistic: ({ id, name }) => {
      const current = cachedIssue(id, true);
      return current ? { ...current, name } : undefined;
    },
    refresh: ({ id, moduleIds = [] }, entity) => [
      refreshRead(WorkTrackerWorkItemDocument, { id }),
      ...moduleIds.map((moduleId) =>
        refreshRead(WorkTrackerModuleOpenDocument, { moduleId })),
      ...(entity.module_id
        ? [refreshRead(WorkTrackerModuleOpenDocument, { moduleId: entity.module_id })]
        : []),
    ],
    committed: (entity) => events.push(`committed:${entity.name}`),
    diagnostics: {
      requested: () => events.push("requested"),
      written: (entity) => events.push(`written:${entity.name}`),
      refreshed: () => events.push("refreshed"),
      failed: (phase) => events.push(`failed:${phase}`),
    },
  });
}

/** A test-only delete that evicts the item and refreshes its module. */
function deleteDeclaration() {
  return declareMutation({
    document: DeleteWorkTrackerWorkItemDocument,
    variables: ({ id }: { id: string; moduleId: string }) => ({ id }),
    root: "delete_work_item",
    evict: ({ id }) => [{ __typename: "WorktrackerIssue", id }],
    refresh: ({ moduleId }) => [refreshRead(WorkTrackerModuleOpenDocument, { moduleId })],
  });
}

describe("declared mutation executor", () => {
  it("writes, commits the authoritative entity once, then refreshes each declared read once", async () => {
    const transport = installScriptedGraphQlTransport();
    const renamed = issueRow("item-1", { name: "Renamed", updated_at: "2026-10-02T00:00:00Z" });
    transport
      .answer("UpdateWorkTrackerWorkItemDetails", { update_work_item: renamed })
      .answer("WorkTrackerWorkItem", workItemData(renamed))
      .answer("WorkTrackerModuleOpen", moduleOpenData([renamed]));
    const events: string[] = [];

    const result = await executeDeclaredMutation(renameDeclaration(events), {
      id: "item-1",
      name: "Renamed",
      moduleIds: ["module-1", "module-1"],
    });

    expect(result).toMatchObject({ id: "item-1", name: "Renamed" });
    expect(transport.requests).toEqual([
      {
        operationName: "UpdateWorkTrackerWorkItemDetails",
        variables: { id: "item-1", name: "Renamed" },
      },
      { operationName: "WorkTrackerWorkItem", variables: { id: "item-1" } },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
    ]);
    expect(events).toEqual([
      "requested",
      "written:Renamed",
      "committed:Renamed",
      "refreshed",
    ]);
    expect(cachedIssue("item-1")).toMatchObject({ name: "Renamed" });
    expect(cachedModuleIds("module-1")).toEqual(["item-1"]);
  });

  it("never joins or is overwritten by a module read that started before the write", async () => {
    const transport = installScriptedGraphQlTransport();
    const before = issueRow("item-1", { name: "Before" });
    const renamed = issueRow("item-1", { name: "Renamed", state_revision: 2 });
    const held = transport.holdNext("WorkTrackerModuleOpen");
    transport
      .answer("UpdateWorkTrackerWorkItemDetails", { update_work_item: renamed })
      .answer("WorkTrackerWorkItem", workItemData(renamed))
      .answer("WorkTrackerModuleOpen", moduleOpenData([renamed]));
    const preWriteRead = studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
    });
    await held.reached;

    await executeDeclaredMutation(renameDeclaration(), {
      id: "item-1",
      name: "Renamed",
      moduleIds: ["module-1"],
    });

    expect(transport.operationNames()).toEqual([
      "WorkTrackerModuleOpen",
      "UpdateWorkTrackerWorkItemDetails",
      "WorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
    held.answer(moduleOpenData([before, issueRow("item-gone")]));
    await preWriteRead;
    expect(cachedIssue("item-1")).toMatchObject({ name: "Renamed", state_revision: 2 });
    expect(cachedModuleIds("module-1")).toEqual(["item-1"]);
  });

  it("keeps a later delete's refresh when an earlier create's refresh lands after it", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", []);
    const created = issueRow("item-1");
    const heldCreateRefresh = transport.holdNext("WorkTrackerModuleOpen");
    transport
      .answer("CreateWorkTrackerWorkItem", { create_work_item: created })
      .answer("DeleteWorkTrackerWorkItem", { delete_work_item: true })
      .answer("WorkTrackerModuleOpen", moduleOpenData([]));
    const refreshModule = ({ moduleId }: { moduleId: string }) => [
      refreshRead(WorkTrackerModuleOpenDocument, { moduleId }),
    ];
    const createIssue = declareMutation({
      document: CreateWorkTrackerWorkItemDocument,
      variables: ({ name }: { name: string; moduleId: string }) => ({
        projectId: "project-1",
        name,
        issueTypeId: "type-1",
        parentId: "module-1",
      }),
      root: "create_work_item",
      refresh: refreshModule,
    });
    const deleteIssue = declareMutation({
      document: DeleteWorkTrackerWorkItemDocument,
      variables: ({ id }: { id: string; moduleId: string }) => ({ id }),
      root: "delete_work_item",
      evict: ({ id }) => [{ __typename: "WorktrackerIssue", id }],
      refresh: refreshModule,
    });

    const create = executeDeclaredMutation(createIssue, { name: "item-1", moduleId: "module-1" });
    await heldCreateRefresh.reached;
    await executeDeclaredMutation(deleteIssue, { id: "item-1", moduleId: "module-1" });
    expect(cachedModuleIds("module-1")).toEqual([]);
    heldCreateRefresh.answer(moduleOpenData([created]));
    await create;

    expect(transport.operationNames()).toEqual([
      "CreateWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
      "DeleteWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
    expect(cachedModuleIds("module-1")).toEqual([]);
    expect(cachedIssue("item-1")).toBeNull();
  });

  it("rolls back the optimistic layer and reports a write failure with its ApiError status", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { name: "Before" })]);
    const held = transport.holdNext("UpdateWorkTrackerWorkItemDetails");
    const events: string[] = [];

    const rename = executeDeclaredMutation(renameDeclaration(events), {
      id: "item-1",
      name: "Renamed",
      moduleIds: ["module-1"],
    });
    await held.reached;
    expect(cachedIssue("item-1", true)).toMatchObject({ name: "Renamed" });
    held.fail("conflict", "Changed elsewhere");
    const failure = await rename.catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      body: { code: "conflict", detail: "Changed elsewhere" },
    });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(cachedIssue("item-1", true)).toMatchObject({ name: "Before" });
    expect(transport.operationNames()).toEqual(["UpdateWorkTrackerWorkItemDetails"]);
    expect(events).toEqual(["requested", "failed:write"]);
  });

  it("keeps a committed write when its refresh fails and never re-sends it", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { name: "Before" })]);
    const renamed = issueRow("item-1", { name: "Renamed", state_revision: 2 });
    transport
      .answer("UpdateWorkTrackerWorkItemDetails", { update_work_item: renamed })
      .answer("WorkTrackerModuleOpen", moduleOpenData([renamed]))
      .failNext("WorkTrackerWorkItem", "worktracker_read_unavailable", "Read unavailable");
    const events: string[] = [];

    const failure = await executeDeclaredMutation(renameDeclaration(events), {
      id: "item-1",
      name: "Renamed",
      moduleIds: ["module-1"],
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 422, body: { code: "worktracker_read_unavailable" } });
    expect(mutationFailurePhase(failure)).toBe("refresh");
    expect(cachedIssue("item-1")).toMatchObject({ name: "Renamed" });
    expect(cachedModuleIds("module-1")).toEqual(["item-1"]);
    expect(transport.operationNames().filter((name) => name === "UpdateWorkTrackerWorkItemDetails"))
      .toHaveLength(1);
    expect(events).toEqual([
      "requested",
      "written:Renamed",
      "committed:Renamed",
      "failed:refresh",
    ]);
  });

  it("keeps a committed delete when its refresh fails and a pre-write module read lands later", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1")]);
    const held = transport.holdNext("WorkTrackerModuleOpen");
    transport
      .answer("DeleteWorkTrackerWorkItem", { delete_work_item: true })
      .failNext("WorkTrackerModuleOpen", "worktracker_read_unavailable", "Read unavailable");
    const preWriteRead = studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
    });
    await held.reached;

    const failure = await executeDeclaredMutation(deleteDeclaration(), {
      id: "item-1",
      moduleId: "module-1",
    }).catch((error: unknown) => error);
    expect(mutationFailurePhase(failure)).toBe("refresh");
    expect(cachedModuleIds("module-1")).toEqual([]);
    held.answer(moduleOpenData([issueRow("item-1")]));
    await preWriteRead;

    expect(cachedModuleIds("module-1")).toEqual([]);
    expect(cachedIssue("item-1")).toBeNull();
    expect(transport.operationNames()).toEqual([
      "WorkTrackerModuleOpen",
      "DeleteWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
    ]);
  });

  it("re-reads instead of writing a stale pre-write read the cache cannot answer", async () => {
    const transport = installScriptedGraphQlTransport();
    const held = transport.holdNext("WorkTrackerModuleOpen");
    transport
      .answer("DeleteWorkTrackerWorkItem", { delete_work_item: true })
      .failNext("WorkTrackerModuleOpen", "worktracker_read_unavailable", "Read unavailable")
      .answer("WorkTrackerModuleOpen", moduleOpenData([]));
    const preWriteRead = studioApolloClient().query({
      query: WorkTrackerModuleOpenDocument,
      variables: { moduleId: "module-1" },
    });
    await held.reached;

    await executeDeclaredMutation(deleteDeclaration(), { id: "item-1", moduleId: "module-1" })
      .catch(() => undefined);
    held.answer(moduleOpenData([issueRow("item-1")]));
    const { data } = await preWriteRead;

    expect(data?.work_items.nodes).toEqual([]);
    expect(cachedModuleIds("module-1")).toEqual([]);
    expect(cachedIssue("item-1")).toBeNull();
    expect(transport.operationNames()).toEqual([
      "WorkTrackerModuleOpen",
      "DeleteWorkTrackerWorkItem",
      "WorkTrackerModuleOpen",
      "WorkTrackerModuleOpen",
    ]);
  });

  it("runs the post-commit hook once even when an optimistic layer was applied", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1", { name: "Before" })]);
    const renamed = issueRow("item-1", { name: "Renamed" });
    transport
      .answer("UpdateWorkTrackerWorkItemDetails", { update_work_item: renamed })
      .answer("WorkTrackerWorkItem", workItemData(renamed))
      .answer("WorkTrackerModuleOpen", moduleOpenData([renamed]));
    const events: string[] = [];

    await executeDeclaredMutation(renameDeclaration(events), { id: "item-1", name: "Renamed" });

    expect(events.filter((event) => event.startsWith("committed"))).toEqual(["committed:Renamed"]);
  });

  it("evicts declared identities and collects the garbage they leave behind", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [
      issueRow("item-1", {
        blocked_by_edges: {
          __typename: "WorktrackerIssueBlockedByConnection",
          nodes: [{ __typename: "WorktrackerIssueBlockedBy", id: 41, to_issue_id: "item-9" }],
        },
      } as never),
      issueRow("item-2"),
    ]);
    transport
      .answer("DeleteWorkTrackerWorkItem", { delete_work_item: true })
      .answer("WorkTrackerModuleOpen", moduleOpenData([issueRow("item-2")]));
    const deleteIssue = declareMutation({
      document: DeleteWorkTrackerWorkItemDocument,
      variables: ({ id }: { id: string; moduleId: string }) => ({ id }),
      root: "delete_work_item",
      optimistic: () => true,
      evict: ({ id }) => [{ __typename: "WorktrackerIssue", id }],
      refresh: ({ moduleId }) => [refreshRead(WorkTrackerModuleOpenDocument, { moduleId })],
    });

    await executeDeclaredMutation(deleteIssue, { id: "item-1", moduleId: "module-1" });

    const stored = Object.keys(studioApolloClient().cache.extract() as object);
    expect(stored).not.toContain("WorktrackerIssue:item-1");
    expect(stored.filter((key) => key.startsWith("WorktrackerIssueBlockedBy:"))).toEqual([]);
    expect(cachedModuleIds("module-1")).toEqual(["item-2"]);
  });
});
