import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../../shared/api/errors";
import { mutationFailurePhase } from "../../shared/apollo/declaredMutation";
import { resetStudioApolloClient, studioApolloClient } from "../../shared/apollo/client";
import { installScriptedGraphQlTransport } from "../../test/scriptedGraphQlTransport";
import {
  cachedIssue,
  cachedModuleIds,
  issueRow,
  moduleOpenData,
  seedModule,
  WorkTrackerModuleOpenDocument,
} from "../../test/workItemCacheFixtures";
import { useCreateWorkItem } from "./mutations";
import { createWorkItem, deleteWorkItem } from "./mutationTransport";
import { consumeLocalWorkItemConvergence } from "./workItemConvergence";

afterEach(async () => resetStudioApolloClient());

function optimisticModuleIds(moduleId: string): string[] | undefined {
  return studioApolloClient().readQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    optimistic: true,
  })?.work_items.nodes.map((row) => row.id);
}

describe("work-item create", () => {
  it("leaves exactly one row once the optimistic row resolves", async () => {
    const transport = installScriptedGraphQlTransport();
    const existing = issueRow("item-1");
    const created = issueRow("item-2", { name: "New", updated_at: "2026-10-02T00:00:00Z" });
    seedModule("module-1", [existing]);
    const write = transport.holdNext("CreateWorkTrackerWorkItem");
    transport.answer("WorkTrackerModuleOpen", moduleOpenData([existing, created]));
    const mutation = renderHook(() =>
      useCreateWorkItem({ projectId: "project-1", moduleId: "module-1" }));

    let pending!: Promise<unknown>;
    act(() => {
      pending = mutation.result.current.mutateAsync({ name: "New", issue_type_id: "type-1" });
    });
    const request = await write.reached;
    expect(request.variables).toEqual({ projectId: "project-1", name: "New", issueTypeId: "type-1" });
    const optimistic = optimisticModuleIds("module-1");
    expect(optimistic).toHaveLength(2);
    expect(optimistic?.[1]).toMatch(/^optimistic:/);

    write.answer({ create_work_item: created });
    await act(async () => {
      await expect(pending).resolves.toMatchObject({ id: "item-2", name: "New" });
    });

    expect(optimisticModuleIds("module-1")).toEqual(["item-1", "item-2"]);
    expect(cachedModuleIds("module-1")).toEqual(["item-1", "item-2"]);
    expect(transport.operationNames()).toEqual(["CreateWorkTrackerWorkItem", "WorkTrackerModuleOpen"]);
    expect(consumeLocalWorkItemConvergence("item-2", "2026-10-02T00:00:00Z")).toBe(true);
  });

  it("rolls back a failed create and rejects with the mapped ApiError", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("item-1")]);
    transport.failNext("CreateWorkTrackerWorkItem", "field_validation", "Name is required");
    const mutation = renderHook(() =>
      useCreateWorkItem({ projectId: "project-1", moduleId: "module-1" }));

    let failure: unknown;
    await act(async () => {
      failure = await mutation.result.current.mutateAsync({ name: "", issue_type_id: "type-1" })
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 422,
      body: { code: "field_validation", detail: "Name is required" },
    });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(optimisticModuleIds("module-1")).toEqual(["item-1"]);
    expect(transport.operationNames()).toEqual(["CreateWorkTrackerWorkItem"]);
    expect(mutation.result.current.error).toBe(failure);
  });

  it("refreshes a module list no component is watching to the server's rows", async () => {
    const transport = installScriptedGraphQlTransport();
    const created = issueRow("module-item", { module_id: "module-2", parent_id: null });
    transport
      .answerNext("CreateWorkTrackerWorkItem", { create_work_item: created })
      .answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
        moduleOpenData(moduleId === "module-2" ? [issueRow("sibling"), created] : []));

    await expect(createWorkItem(
      "project-1",
      { name: "Module", issue_type_id: "type-module", parent_id: null },
      { moduleId: "module-2" },
    )).resolves.toMatchObject({ id: "module-item" });

    expect(transport.requests).toEqual([
      {
        operationName: "CreateWorkTrackerWorkItem",
        variables: { projectId: "project-1", name: "Module", issueTypeId: "type-module", parentId: null },
      },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-2" } },
    ]);
    expect(cachedModuleIds("module-2")).toEqual(["sibling", "module-item"]);
  });
});

const doomedId = "0123456789abcdef0123456789abcdef";
const doomedPublicId = "01234567-89ab-cdef-0123-456789abcdef";

describe("work-item delete", () => {
  it("evicts the compacted identity from every list, and it stays gone after refresh", async () => {
    const transport = installScriptedGraphQlTransport();
    const keep = issueRow("keep");
    seedModule("module-1", [keep, issueRow(doomedId)]);
    const write = transport.holdNext("DeleteWorkTrackerWorkItem");
    transport.answer("WorkTrackerModuleOpen", ({ moduleId }: Record<string, unknown>) =>
      moduleOpenData(moduleId === "module-1" ? [keep] : [issueRow("other", { module_id: "module-2" })]));

    const pending = deleteWorkItem(doomedPublicId, { moduleId: "module-1", moduleIds: ["module-2"] });
    const request = await write.reached;
    expect(request.variables).toEqual({ id: doomedId });

    write.answer({ delete_work_item: true });
    await expect(pending).resolves.toBeUndefined();

    expect(transport.requests).toEqual([
      { operationName: "DeleteWorkTrackerWorkItem", variables: { id: doomedId } },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-1" } },
      { operationName: "WorkTrackerModuleOpen", variables: { moduleId: "module-2" } },
    ]);
    expect(cachedIssue(doomedId)).toBeNull();
    expect(cachedModuleIds("module-1")).toEqual(["keep"]);
    expect(cachedModuleIds("module-2")).toEqual(["other"]);
  });

  it("restores the row when the delete fails and rejects with the mapped ApiError", async () => {
    const transport = installScriptedGraphQlTransport();
    seedModule("module-1", [issueRow("keep"), issueRow(doomedId)]);
    transport.failNext("DeleteWorkTrackerWorkItem", "not_found", "Not found");

    const failure = await deleteWorkItem(doomedPublicId, { moduleId: "module-1" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 404 });
    expect(mutationFailurePhase(failure)).toBe("write");
    expect(optimisticModuleIds("module-1")).toEqual(["keep", doomedId]);
    expect(transport.operationNames()).toEqual(["DeleteWorkTrackerWorkItem"]);
  });
});
